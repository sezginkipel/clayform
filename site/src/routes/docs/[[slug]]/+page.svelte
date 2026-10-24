<script lang="ts">
	import { page as current } from '$app/state';
	import { SITE_NAME, SITE_URL } from '$lib/meta';

	let { data } = $props();
	let menuOpen = $state(false);
	const here = $derived(data.page.slug);
	const toc = $derived(data.page.headings.filter((h) => h.depth === 2));
	const pageTitle = $derived(data.page.slug ? `${data.page.title} — Clayform docs` : 'Clayform documentation');
	const pageUrl = $derived(data.page.slug ? `${SITE_URL}/docs/${data.page.slug}` : `${SITE_URL}/docs`);
	const jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'TechArticle',
					'@id': `${pageUrl}#article`,
					headline: data.page.title,
					description: data.page.description,
					url: pageUrl,
					image: `${SITE_URL}/og-card.png`,
					inLanguage: 'en',
					author: {
						'@type': 'Organization',
						name: SITE_NAME,
						url: SITE_URL
					},
					publisher: {
						'@type': 'Organization',
						name: SITE_NAME,
						url: SITE_URL
					},
					isPartOf: {
						'@id': `${SITE_URL}/#website`
					}
				},
				{
					'@type': 'BreadcrumbList',
					itemListElement: [
						{
							'@type': 'ListItem',
							position: 1,
							name: 'Clayform',
							item: SITE_URL
						},
						{
							'@type': 'ListItem',
							position: 2,
							name: 'Docs',
							item: `${SITE_URL}/docs`
						},
						...(data.page.slug
							? [
									{
										'@type': 'ListItem',
										position: 3,
										name: data.page.title,
										item: pageUrl
									}
								]
							: [])
					]
				}
			]
		})
	);

	// close the phone menu when the page changes
	$effect(() => {
		void current.url.pathname;
		menuOpen = false;
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={data.page.description} />
	<meta property="og:type" content="article" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={data.page.description} />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={data.page.description} />
	{@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<div class="docs">
	<button class="menu" type="button" aria-expanded={menuOpen} aria-controls="sidebar" onclick={() => (menuOpen = !menuOpen)}>
		<span>{menuOpen ? 'Close documentation menu' : `Docs: ${data.page.title}`}</span>
		<span aria-hidden="true">{menuOpen ? '▴' : '▾'}</span>
	</button>

	<aside id="sidebar" class:open={menuOpen} aria-label="Documentation">
		{#each data.nav as group (group.name)}
			<p class="group">{group.name}</p>
			<ul>
				{#each group.items as item (item.slug)}
					<li>
						<a href={item.slug ? `/docs/${item.slug}` : '/docs'} aria-current={item.slug === here ? 'page' : undefined}>{item.title}</a>
					</li>
				{/each}
			</ul>
		{/each}
	</aside>

	<main id="main">
		<article class="prose">
			{@html data.page.html}
		</article>
		<p class="edit"><a href={data.page.source} rel="noopener">Improve this page on GitHub</a></p>
	</main>

	{#if toc.length > 2}
		<nav class="toc" aria-label="On this page">
			<p class="group">On this page</p>
			<ul>
				{#each toc as h (h.id)}
					<li><a href={`#${h.id}`}>{h.text}</a></li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>

<style>
	.docs {
		max-width: 1320px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 232px minmax(0, 1fr) 208px;
		gap: var(--s7);
		padding: var(--s6) var(--s5) 0;
	}
	.menu {
		display: none;
	}
	aside,
	.toc {
		position: sticky;
		top: calc(var(--header) + var(--s5));
		align-self: start;
		max-height: calc(100vh - var(--header) - var(--s6));
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--line) transparent;
		font-size: 14.5px;
	}
	.group {
		margin: var(--s5) 0 var(--s2);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.group:first-child {
		margin-top: 0;
	}
	aside ul,
	.toc ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	aside a,
	.toc a {
		display: flex;
		align-items: center;
		padding: 6px var(--s3);
		margin-left: calc(-1 * var(--s3));
		text-decoration: none;
		color: var(--ink-2);
		border-radius: var(--radius);
		min-height: 36px;
	}
	aside a[aria-current='page'] {
		background: var(--blue-wash);
		color: var(--ink);
		font-weight: 600;
		box-shadow: inset 3px 0 0 var(--blue);
	}
	.toc a {
		font-size: 13.5px;
		padding: 4px var(--s3);
		min-height: 32px;
	}
	main {
		min-width: 0;
	}
	.edit {
		margin-top: var(--s7);
		font-size: 14px;
		color: var(--ink-3);
	}

	/* the rendered markdown */
	.prose {
		max-width: 76ch;
		min-width: 0;
	}
	.prose :global(h1) {
		font-size: clamp(28px, 4vw, 38px);
		line-height: 1.12;
		letter-spacing: -0.02em;
		margin: 0 0 var(--s5);
		overflow-wrap: break-word;
	}
	.prose :global(h2) {
		font-size: clamp(21px, 3vw, 25px);
		line-height: 1.25;
		letter-spacing: -0.01em;
		margin: var(--s7) 0 var(--s3);
		padding-top: var(--s4);
		border-top: 1px solid var(--line);
		overflow-wrap: break-word;
	}
	.prose :global(h3) {
		font-size: 19px;
		margin: var(--s6) 0 var(--s2);
	}
	.prose :global(h4) {
		font-size: 16px;
		margin: var(--s5) 0 var(--s2);
	}
	.prose :global(.anchor) {
		float: left;
		margin-left: -1em;
		width: 1em;
		text-decoration: none;
		color: var(--ink-3);
		opacity: 0;
	}
	.prose :global(h2:hover .anchor),
	.prose :global(h3:hover .anchor),
	.prose :global(.anchor:focus) {
		opacity: 1;
	}
	.prose :global(p),
	.prose :global(li) {
		color: var(--ink);
		overflow-wrap: break-word;
	}
	.prose :global(ul),
	.prose :global(ol) {
		padding-left: 1.3em;
	}
	.prose :global(li + li) {
		margin-top: var(--s1);
	}
	.prose :global(:not(pre) > code) {
		background: var(--wash);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 4px;
		font-size: 0.86em;
		overflow-wrap: anywhere;
	}
	.prose :global(figure.code) {
		position: relative;
		margin: var(--s4) 0;
		max-width: 100%;
	}
	.prose :global(pre) {
		margin: 0;
		max-width: 100%;
		background: var(--wash);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: var(--s4);
		overflow-x: auto;
		font-size: 13px;
		line-height: 1.55;
	}
	.prose :global(.verified) {
		position: absolute;
		top: -10px;
		right: var(--s3);
		font-family: var(--mono);
		font-size: 11.5px;
		background: var(--ok-wash);
		color: var(--ok-ink);
		border: 1px solid #bfdcc9;
		padding: 0 7px;
		border-radius: 4px;
	}
	.prose :global(.k) {
		color: #1c3f94;
	}
	.prose :global(.s) {
		color: #1f5e36;
	}
	.prose :global(.n) {
		color: #8a3a0f;
	}
	.prose :global(.c) {
		color: var(--ink-3);
	}
	.prose :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 14.5px;
		margin: var(--s4) 0;
	}
	.prose :global(th),
	.prose :global(td) {
		text-align: left;
		vertical-align: top;
		padding: var(--s2) var(--s3);
		border-bottom: 1px solid var(--line);
	}
	.prose :global(th) {
		font-weight: 600;
		border-bottom-color: var(--line-strong);
	}
	.prose :global(img) {
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.prose :global(blockquote) {
		margin: var(--s4) 0;
		padding: var(--s2) var(--s4);
		border-left: 3px solid var(--line-strong);
		color: var(--ink-2);
	}

	@media (max-width: 1180px) {
		.docs {
			grid-template-columns: 220px minmax(0, 1fr);
		}
		.toc {
			display: none;
		}
	}
	@media (max-width: 860px) {
		.docs {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s4);
			padding: var(--s4) var(--s4) 0;
		}
		.menu {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--s2);
			font: inherit;
			font-size: 15px;
			font-weight: 600;
			min-height: 44px;
			border: 1px solid var(--line-strong);
			background: var(--wash);
			border-radius: var(--radius);
			text-align: left;
			padding: 0 var(--s4);
			cursor: pointer;
		}
		aside {
			display: none;
			position: static;
			max-height: none;
			background: var(--wash);
			border: 1px solid var(--line);
			border-radius: var(--radius);
			padding: var(--s4);
		}
		aside.open {
			display: block;
		}
		aside a {
			min-height: 42px;
			margin-left: 0;
		}
		.prose :global(.anchor) {
			display: none;
		}
		.prose :global(pre) {
			padding: var(--s4) var(--s3) var(--s3);
			font-size: 12px;
		}
	}
</style>

