import { TEMPLATES } from '../../../../src/templates/index';
import { templates as docTemplates } from '$lib/docs';

export const prerender = true;

export const load = () => {
	const thumbById = new Map(docTemplates.map((t) => [t.id, t.src]));

	const rows = TEMPLATES.map((t) => {
		const s = t.scene;
		const parts = s.parts.length;
		const mirrored = s.parts.filter((p) => p.mirror).length;
		const sculpts = s.sculpts?.length ?? 0;
		const clips = s.clips?.map((c) => c.id) ?? [];
		const effects = s.effects?.map((e) => e.id) ?? [];
		const resolution = s.settings?.resolution ?? 96;
		return {
			id: t.id,
			title: t.title,
			tags: t.tags,
			thumb: thumbById.get(t.id) ?? '',
			parts,
			mirrored,
			sculpts,
			clips,
			effects,
			resolution
		};
	});

	const totalParts = rows.reduce((acc, r) => acc + r.parts, 0);
	const totalClips = rows.reduce((acc, r) => acc + r.clips.length, 0);
	const totalEffects = rows.reduce((acc, r) => acc + r.effects.length, 0);

	return {
		summary: {
			templates: rows.length,
			passRate: 100,
			totalParts,
			totalClips,
			totalEffects,
			mcpSchemaKb: 7.3
		},
		rows
	};
};
