// Windows can hold .svelte-kit/cloudflare for a few seconds after a build (EPERM when the
// adapter clears it). Clear it ourselves, retrying, then build.
import { rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const out = '.svelte-kit/cloudflare';
for (let i = 0; i < 20; i++) {
	try {
		rmSync(out, { recursive: true, force: true });
		break;
	} catch (e) {
		if (i === 19) throw e;
		await new Promise((r) => setTimeout(r, 500));
	}
}
execSync('npx vite build', { stdio: 'inherit' });
