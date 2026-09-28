/**
 * Format versions and migrations.
 *
 * `clayform/1` is frozen: every document that was valid under it stays valid
 * and means the same thing. New optional fields can still be added (old
 * documents simply do not use them). A change that would make an old
 * document invalid, or change what it builds, bumps the format and adds a
 * migration here, so old files load and are upgraded on the way in.
 */

export interface Migration {
	from: string;
	to: string;
	/** what changed, in one line, shown when a document is upgraded */
	note: string;
	up: (doc: Record<string, unknown>) => Record<string, unknown>;
}

/** Scene migrations, oldest first. clayform/1 is the first format, so the chain starts empty. */
export const SCENE_MIGRATIONS: Migration[] = [];

export type MigrateResult = { ok: true; doc: unknown; steps: string[] } | { ok: false; error: string };

/** Walk a document up the chain to `target`. Documents without a `format` are left for the schema to reject. */
export function migrate(input: unknown, target: string, chain: Migration[] = SCENE_MIGRATIONS): MigrateResult {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: true, doc: input, steps: [] };
	let doc = input as Record<string, unknown>;
	const steps: string[] = [];
	const seen = new Set<string>();
	while (typeof doc.format === 'string' && doc.format !== target) {
		const from = doc.format;
		if (seen.has(from)) return { ok: false, error: `migration loop at "${from}"` };
		seen.add(from);
		const m = chain.find((x) => x.from === from);
		if (!m) {
			const known = [...new Set([target, ...chain.map((x) => x.from)])].join(', ');
			return { ok: false, error: `unknown format "${from}" — this Clayform reads ${known}. A newer file needs a newer Clayform (npm i @s1444/clayform@latest).` };
		}
		doc = { ...m.up(structuredClone(doc)), format: m.to };
		steps.push(`${m.from} → ${m.to}: ${m.note}`);
	}
	return { ok: true, doc, steps };
}
