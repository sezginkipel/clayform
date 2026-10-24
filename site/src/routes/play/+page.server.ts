import { TEMPLATES } from '../../../../src/templates/index';
import { templates as docTemplates } from '$lib/docs';

export const prerender = true;

export const load = () => {
	const thumbById = new Map(docTemplates.map((t) => [t.id, t.src]));
	return {
		templates: TEMPLATES.map((t) => ({
			id: t.id,
			title: t.title,
			tags: t.tags,
			description: t.description,
			thumb: thumbById.get(t.id) ?? '',
			scene: t.scene
		}))
	};
};
