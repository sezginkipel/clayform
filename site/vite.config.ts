import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: adapter(),
			prerender: { handleHttpError: 'fail', handleMissingId: 'fail' },
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'script-src': ['self'],
					'connect-src': ['self'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			}
		})
	],
	// the pages are the repository's own docs/*.md, one level up
	server: { port: 5232, strictPort: true, fs: { allow: ['..'] } },
	build: { assetsInlineLimit: 0 }
});
