<script lang="ts">
	let { data } = $props();
	const host = (u: string) => new URL(u).host.replace(/^www\./, '');
</script>

<svelte:head>
	<title>Showcase — made with Clayform</title>
	<meta name="description" content="Games and sites whose models, animations or effects were made with Clayform." />
</svelte:head>

<main id="main">
	<header class="intro">
		<h1>Made with Clayform</h1>
		<p>
			Projects whose models, animations or effects came out of Clayform. Each one is live, and each says what Clayform made in
			it.
		</p>
	</header>

	<ol class="list">
		{#each data.entries as e (e.slug)}
			<li id={e.slug}>
				<a class="shot" href={e.url} rel="noopener">
					<img src={e.image} alt={e.imageAlt} loading="lazy" />
				</a>
				<div class="text">
					<h2><a href={e.url} rel="noopener">{e.name}</a></h2>
					<p class="by">
						by {#if e.byUrl}<a href={e.byUrl} rel="noopener">{e.by}</a>{:else}{e.by}{/if} · {host(e.url)}
					</p>
					<p>{e.summary}</p>
					<h3>What Clayform made</h3>
					<p>{e.clayform}</p>
					{#if e.tags?.length}
						<ul class="tags" aria-label="Tags">
							{#each e.tags as t (t)}<li>{t}</li>{/each}
						</ul>
					{/if}
					<p class="go">
						<a class="button" href={e.url} rel="noopener">Visit {e.name}</a>
						{#if e.repo}<a href={e.repo} rel="noopener">Source</a>{/if}
					</p>
				</div>
			</li>
		{/each}
	</ol>

	<section class="add" aria-labelledby="add-title">
		<h2 id="add-title">Made something with Clayform?</h2>
		<p>
			Send it in. Fill in a short form with a link and a picture, and we add it here after a look. Or open a pull request
			with a small JSON file, and the tests check it for you.
		</p>
		<p class="go">
			<a class="button" href={data.submit} rel="noopener">Send your project</a>
			<a href="/docs/showcase">Read the rules</a>
		</p>
	</section>
</main>

<style>
	main {
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 var(--s5);
	}
	.intro {
		padding: var(--s8) 0 var(--s6);
		max-width: 720px;
	}
	h1 {
		margin: 0;
		font-size: clamp(32px, 4.6vw, 50px);
		line-height: 1.08;
		letter-spacing: -0.025em;
	}
	.intro p {
		margin: var(--s4) 0 0;
		font-size: 18px;
		color: var(--ink-2);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list > li {
		border-top: 1px solid var(--line);
		padding: var(--s6) 0 var(--s7);
		display: grid;
		gap: var(--s5);
	}
	.shot {
		display: block;
		border-radius: var(--radius);
	}
	.shot img {
		display: block;
		width: 100%;
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.shot:hover {
		background: none;
	}
	.shot:hover img {
		border-color: var(--blue-line);
	}
	.text {
		max-width: 720px;
	}
	h2 {
		margin: 0;
		font-size: 28px;
		letter-spacing: -0.015em;
	}
	h2 a {
		text-decoration: none;
	}
	.by {
		margin: var(--s1) 0 var(--s4);
		color: var(--ink-3);
		font-size: 15px;
	}
	.text p {
		margin: 0 0 var(--s3);
		color: var(--ink-2);
	}
	h3 {
		margin: var(--s5) 0 var(--s1);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.tags {
		list-style: none;
		padding: 0;
		margin: var(--s4) 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
	}
	.tags li {
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--ink-2);
		background: var(--wash);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 1px 8px;
	}
	.go {
		margin-top: var(--s5) !important;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s4);
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--s5);
		background: var(--blue);
		color: #fff;
		font-weight: 600;
		text-decoration: none;
		border-radius: var(--radius);
	}
	.button:hover {
		background: #15317a;
	}
	.add {
		border-top: 1px solid var(--line);
		padding: var(--s7) 0 0;
		max-width: 720px;
	}
	.add h2 {
		margin-bottom: var(--s3);
	}
	.add p {
		color: var(--ink-2);
		margin: 0;
	}
	@media (min-width: 960px) {
		.list > li {
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
			gap: var(--s6);
			align-items: start;
		}
	}
	@media (max-width: 640px) {
		main {
			padding: 0 var(--s4);
		}
		.intro {
			padding-top: var(--s7);
		}
	}
</style>
