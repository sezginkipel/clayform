/**
 * Clayform MCP over streamable HTTP, for hosted use.
 *
 *   clayform serve --port 8787 --token $CLAYFORM_TOKEN
 *
 * Every MCP session gets its own workspace folder, and every path a tool is
 * given is confined to it. Sessions end when the client closes them or after
 * sitting idle; their folders are then removed (unless `keep`).
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { withFileRoot } from '../core/files.js';
import { VERSION } from '../version.js';
import { createServer } from './server.js';

export interface HttpOptions {
	port?: number;
	host?: string;
	/** sessions live in <workspace>/sessions/<id> */
	workspace?: string;
	/** required as `Authorization: Bearer <token>` when set */
	token?: string;
	maxSessions?: number;
	/** minutes without a request before a session is closed */
	idleMinutes?: number;
	/** keep session folders after the session ends */
	keep?: boolean;
}

export interface HttpHandle {
	server: Server;
	url: string;
	sessions: () => number;
	close: () => Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export async function serveHttp(opts: HttpOptions = {}): Promise<HttpHandle> {
	const host = opts.host ?? '127.0.0.1';
	if (!LOOPBACK.has(host) && !opts.token) throw new Error(`serving on ${host} without a token would let anyone who can reach it run tools and fill the disk — set --token or CLAYFORM_TOKEN`);
	const base = resolve(opts.workspace ?? '.clayform-hosted');
	const maxSessions = opts.maxSessions ?? 16;
	const idleMs = (opts.idleMinutes ?? 30) * 60_000;
	const sessions = new Map<string, { transport: StreamableHTTPServerTransport; close: () => Promise<void>; dir: string; last: number }>();

	const authorized = (req: IncomingMessage) => {
		if (!opts.token) return true;
		const got = Buffer.from(String(req.headers.authorization ?? ''));
		const want = Buffer.from(`Bearer ${opts.token}`);
		return got.length === want.length && timingSafeEqual(got, want);
	};
	const endSession = async (id: string) => {
		const s = sessions.get(id);
		if (!s) return;
		sessions.delete(id);
		await s.close().catch(() => {});
		if (!opts.keep) rmSync(s.dir, { recursive: true, force: true });
	};
	const reply = (res: import('node:http').ServerResponse, status: number, message: string) => {
		res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
	};

	let port = opts.port ?? 8787;
	const server = createHttpServer(async (req, res) => {
		const path = (req.url ?? '/').split('?')[0];
		if (path === '/' && req.method === 'GET') {
			res.writeHead(200, { 'content-type': 'text/plain' }).end(`Clayform ${VERSION} MCP server — connect an MCP client to /mcp\n`);
			return;
		}
		if (path !== '/mcp') return reply(res, 404, 'not found — the MCP endpoint is /mcp');
		if (!authorized(req)) {
			res.setHeader('www-authenticate', 'Bearer');
			return reply(res, 401, 'missing or wrong bearer token');
		}
		try {
			const sid = req.headers['mcp-session-id'];
			if (typeof sid === 'string') {
				const s = sessions.get(sid);
				if (!s) return reply(res, 404, 'unknown or expired session — start a new one');
				s.last = Date.now();
				await withFileRoot(s.dir, () => s.transport.handleRequest(req, res));
				return;
			}
			if (req.method !== 'POST') return reply(res, 400, 'start a session with an initialize request (POST)');
			if (sessions.size >= maxSessions) return reply(res, 503, `all ${maxSessions} sessions are in use — try again later`);
			const id = randomUUID();
			const dir = join(base, 'sessions', id);
			mkdirSync(dir, { recursive: true });
			const { server: mcp } = createServer(dir);
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => id,
				onsessioninitialized: () => {
					sessions.set(id, { transport, dir, last: Date.now(), close: async () => { await transport.close(); await mcp.close(); } });
				},
				onsessionclosed: () => endSession(id),
				// on a loopback address, refuse requests whose Host header points elsewhere (DNS rebinding)
				...(LOOPBACK.has(host) ? { enableDnsRebindingProtection: true, allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`] } : {})
			});
			await mcp.connect(transport);
			await withFileRoot(dir, () => transport.handleRequest(req, res));
			// not an initialize request: nothing was opened, clean up
			if (!sessions.has(id)) {
				await transport.close().catch(() => {});
				await mcp.close().catch(() => {});
				rmSync(dir, { recursive: true, force: true });
			}
		} catch (e) {
			if (!res.headersSent) reply(res, 500, e instanceof Error ? e.message : String(e));
		}
	});

	const sweep = setInterval(() => {
		const now = Date.now();
		for (const [id, s] of sessions) if (now - s.last > idleMs) void endSession(id);
	}, Math.min(idleMs, 60_000));
	sweep.unref();

	await new Promise<void>((ok, fail) => {
		server.once('error', fail);
		server.listen(port, host, () => ok());
	});
	const addr = server.address();
	if (addr && typeof addr === 'object') port = addr.port;
	const shown = host.includes(':') ? `[${host}]` : host;
	return {
		server,
		url: `http://${shown}:${port}/mcp`,
		sessions: () => sessions.size,
		close: async () => {
			clearInterval(sweep);
			for (const id of [...sessions.keys()]) await endSession(id);
			await new Promise<void>((ok) => server.close(() => ok()));
		}
	};
}
