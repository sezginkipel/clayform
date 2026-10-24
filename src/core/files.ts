/**
 * Where agent-given paths may go.
 *
 * Locally (stdio, CLI, library) a path is resolved as usual. In a hosted
 * session every path an agent names (exports, imports, mesh sources, style
 * sheets, reference images) is confined to that session's workspace. The
 * confinement travels with the request through async calls, so code deep in
 * a build does not need to be told.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const jail = new AsyncLocalStorage<string>();

/** Run `fn` with every agent-given path confined to `root`. */
export function withFileRoot<T>(root: string, fn: () => T): T {
	return jail.run(resolve(root), fn);
}

/** The confining root of the current hosted session, if any. */
export function fileRoot(): string | undefined {
	return jail.getStore();
}

function inside(base: string, target: string): boolean {
	const rel = relative(base, target);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function realAncestor(p: string): string {
	let cur = p;
	while (!existsSync(cur)) {
		const parent = dirname(cur);
		if (parent === cur) return cur;
		cur = parent;
	}
	try {
		return realpathSync(cur);
	} catch {
		return cur;
	}
}

/** Resolve a path an agent gave: as usual locally, inside the workspace in a hosted session. */
export function userPath(p: string): string {
	const root = jail.getStore();
	if (!root) return resolve(p);
	const full = resolve(root, p);
	if (inside(root, full)) {
		const realRoot = existsSync(root) ? realpathSync(root) : root;
		const realTarget = realAncestor(full);
		if (inside(realRoot, realTarget)) return full;
	}
	throw new Error(`"${p}" is outside this session's workspace — a hosted session reads and writes only inside it; use a relative path such as exports/model.glb`);
}

