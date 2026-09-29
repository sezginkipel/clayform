<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { NPM, REPO, VERSION } from '$lib/meta';

	let { children } = $props();
	const inDocs = $derived(page.url.pathname.startsWith('/docs'));
</script>

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
	<nav aria-label="Site">
		<a href="/docs/getting-started" aria-current={inDocs ? 'page' : undefined}>Docs</a>
		<a class="wide" href="/docs/templates">Templates</a>
		<a href="/showcase" aria-current={page.url.pathname.startsWith('/showcase') ? 'page' : undefined}>Showcase</a>
		<a class="wide" href={`${REPO}/blob/main/CHANGELOG.md`} rel="noopener">v{VERSION}</a>
		<a href={REPO} rel="noopener">GitHub</a>
		<a class="wide" href={NPM} rel="noopener">npm</a>
	</nav>
</header>

{@render children()}

<footer class="foot">
	<p>
		Clayform is open source under the Apache-2.0 license. Every picture on this site is a render made by Clayform itself, and
		every example marked <span class="tag">checked by the tests</span> is built by the test suite on each change.
	</p>
	<p><a href={REPO} rel="noopener">Source</a> · <a href={`${REPO}/issues`} rel="noopener">Issues</a> · <a href={`${REPO}/blob/main/ROADMAP.md`} rel="noopener">Roadmap</a></p>
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
		z-index: 5;
		height: var(--header);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s4);
		padding: 0 var(--s5);
		background: rgb(255 255 255 / 0.96);
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
	@media (max-width: 640px) {
		.top {
			padding: 0 var(--s3);
		}
		nav a {
			padding: var(--s2);
		}
		nav .wide {
			display: none;
		}
	}
</style>
