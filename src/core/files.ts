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
import { isAbsolute, relative, resolve } from 'node:path';

const jail = new AsyncLocalStorage<string>();

/** Run `fn` with every agent-given path confined to `root`. */
export function withFileRoot<T>(root: string, fn: () => T): T {
	return jail.run(resolve(root), fn);
}

/** The confining root of the current hosted session, if any. */
export function fileRoot(): string | undefined {
	return jail.getStore();
}

/** Resolve a path an agent gave: as usual locally, inside the workspace in a hosted session. */
export function userPath(p: string): string {
	const root = jail.getStore();
	if (!root) return resolve(p);
	const full = resolve(root, p);
	const rel = relative(root, full);
	if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return full;
	throw new Error(`"${p}" is outside this session's workspace — a hosted session reads and writes only inside it; use a relative path such as exports/model.glb`);
}
