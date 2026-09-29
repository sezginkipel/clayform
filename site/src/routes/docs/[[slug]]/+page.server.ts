import { error } from '@sveltejs/kit';
import { nav, pageBySlug, pages } from '$lib/docs';

export const entries = () => pages.map((p) => ({ slug: p.slug || undefined }));

export const load = ({ params }) => {
	const page = pageBySlug.get(params.slug ?? '');
	if (!page) error(404, `There is no page called "${params.slug}" in the docs.`);
	return { page, nav };
};
