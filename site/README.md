# Clayform docs site

The documentation site, built from the repository's own `docs/*.md` with SvelteKit and
prerendered for Cloudflare. Nothing here is written twice: pages, images and the template
gallery all come from `docs/`.

```bash
npm install
npm run dev      # http://localhost:5232
npm run build    # fails on any broken link or anchor in the docs
npx wrangler deploy
```
