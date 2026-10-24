<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { DEFAULT_OG_ALT, DEFAULT_OG_IMAGE, NPM, REPO, SITE_NAME, SITE_URL, VERSION } from '$lib/meta';

	let { children } = $props();
	let navOpen = $state(false);
	const inDocs = $derived(page.url.pathname.startsWith('/docs'));
	const canonicalUrl = $derived(`${SITE_URL}${page.url.pathname === '/' ? '' : page.url.pathname.replace(/\/$/, '')}`);

	$effect(() => {
		void page.url.pathname;
		navOpen = false;
	});
</script>

<svelte:head>
	<link rel="canonical" href={canonicalUrl} />
	<meta name="theme-color" content="#1c3f94" />
	<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:locale" content="en_US" />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:image" content={DEFAULT_OG_IMAGE} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={DEFAULT_OG_ALT} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content={DEFAULT_OG_IMAGE} />
	<meta name="twitter:image:alt" content={DEFAULT_OG_ALT} />
	<link rel="alternate" type="text/plain" title="LLMs.txt" href={`${SITE_URL}/llms.txt`} />
</svelte:head>

<a class="skip" href="#main">Skip to the content</a>

<header class="top">
	<a class="mark" href="/" aria-label="Clayform home">
		<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"
			><path d="M16 3 28 10v12L16 29 4 22V10z" fill="#1c3f94" /><path d="M16 3 28 10 16 17 4 10z" fill="#4d6fc4" /><path
				d="M16 17v12L4 22V10z"
				fill="#12296a"
			/></svg
		>
		<span>Clayform</span>
	</a>
	<button
		class="nav-toggle"
		type="button"
		aria-expanded={navOpen}
		aria-controls="site-nav"
		aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
		onclick={() => (navOpen = !navOpen)}
	>
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
			{#if navOpen}
				<path d="M6 6l12 12M18 6L6 18" />
			{:else}
				<path d="M4 7h16M4 12h16M4 17h16" />
			{/if}
		</svg>
		<span>Menu</span>
	</button>
	<nav id="site-nav" class:open={navOpen} aria-label="Site">
		<a href="/play" aria-current={page.url.pathname.startsWith('/play') ? 'page' : undefined}>Playground</a>
		<a href="/docs/getting-started" aria-current={inDocs ? 'page' : undefined}>Docs</a>
		<a href="/docs/templates">Templates</a>
		<a href="/benchmark" aria-current={page.url.pathname.startsWith('/benchmark') ? 'page' : undefined}>Benchmarks</a>
		<a href="/showcase" aria-current={page.url.pathname.startsWith('/showcase') ? 'page' : undefined}>Showcase</a>
		<a href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">v{VERSION}</a>
		<a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
		<a href={NPM} target="_blank" rel="noopener noreferrer">npm</a>
	</nav>
</header>

{@render children()}

<footer class="foot">
	<p>
		Clayform is open source under the Apache-2.0 license. Every picture on this site is a render made by Clayform itself, and
		every example marked <span class="tag">checked by the tests</span> is built by the test suite on each change.
	</p>
	<p>
		<a href={REPO} target="_blank" rel="noopener noreferrer">Source</a> ·
		<a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">Issues</a> ·
		<a href={`${REPO}/blob/main/ROADMAP.md`} target="_blank" rel="noopener noreferrer">Roadmap</a> ·
		<a href="/llms.txt" target="_blank" rel="noopener">llms.txt</a> ·
		<a href="/sitemap.xml" target="_blank" rel="noopener">Sitemap</a>
	</p>
</footer>

<style>
	.skip {
		position: absolute;
		left: -9999px;
	}
	.skip:focus {
		left: var(--s4);
		top: var(--s2);
		z-index: 10;
		background: var(--paper);
		padding: var(--s2) var(--s3);
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 20;
		min-height: var(--header);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s4);
		padding: 0 var(--s5);
		background: rgb(255 255 255 / 0.96);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--line);
	}
	.mark {
		display: inline-flex;
		align-items: center;
		gap: var(--s2);
		font-weight: 700;
		font-size: 17px;
		letter-spacing: -0.01em;
		text-decoration: none;
		padding: var(--s1) var(--s2);
		margin-left: calc(-1 * var(--s2));
		min-height: 40px;
	}
	.nav-toggle {
		display: none;
	}
	nav {
		display: flex;
		gap: var(--s1);
	}
	nav a {
		text-decoration: none;
		color: var(--ink-2);
		font-size: 15px;
		padding: var(--s2) var(--s3);
		min-height: 40px;
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
	}
	nav a[aria-current='page'] {
		color: var(--ink);
		font-weight: 600;
		box-shadow: inset 0 -2px 0 var(--blue);
		border-radius: 0;
	}
	.foot {
		border-top: 1px solid var(--line);
		padding: var(--s6) var(--s5) var(--s7);
		color: var(--ink-3);
		font-size: 14px;
		max-width: 1200px;
		margin: var(--s8) auto 0;
	}
	.foot p {
		max-width: 68ch;
		margin: 0 0 var(--s3);
	}
	.tag {
		font-family: var(--mono);
		font-size: 12px;
		background: var(--ok-wash);
		color: var(--ok-ink);
		padding: 1px 6px;
		border-radius: 4px;
		white-space: nowrap;
	}
	@media (max-width: 720px) {
		.top {
			padding: 0 var(--s4);
			flex-wrap: wrap;
		}
		.nav-toggle {
			display: inline-flex;
			align-items: center;
			gap: var(--s2);
			font: inherit;
			font-size: 14px;
			font-weight: 600;
			color: var(--ink);
			background: var(--paper);
			border: 1px solid var(--line-strong);
			border-radius: var(--radius);
			padding: 0 var(--s3);
			min-height: 40px;
			cursor: pointer;
		}
		.nav-toggle:hover {
			background: var(--wash);
		}
		nav {
			display: none;
			width: 100%;
			flex-direction: column;
			gap: 2px;
			padding: var(--s2) 0 var(--s3);
			border-top: 1px solid var(--line);
		}
		nav.open {
			display: flex;
		}
		nav a {
			width: 100%;
			padding: var(--s2) var(--s3);
			min-height: 42px;
			border-radius: var(--radius);
		}
		nav a[aria-current='page'] {
			background: var(--blue-wash);
			box-shadow: inset 3px 0 0 var(--blue);
		}
		.foot {
			padding: var(--s6) var(--s4) var(--s7);
		}
	}
</style>

