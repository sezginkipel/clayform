<script lang="ts">
	import { INSTALL, REPO } from '$lib/meta';

	let { data } = $props();
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(INSTALL);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			copied = false;
		}
	}

	const edit = `// new_scene { "name": "Goblin", "template": "biped" }, then one edit:
[
  { "op": "set_palette", "set": { "skin": "#7fb04a", "shirt": "#6b4a2b", "pants": "#3d3322" } },
  { "op": "update_part", "id": "hair", "set": { "hidden": true } },
  { "op": "add_part", "part": {
      "id": "ear", "role": "ear", "shape": { "type": "cone", "height": 0.16, "radius": 0.045 },
      "attach": { "to": "head", "side": "left", "offset": [0, 0.2], "align": true, "embed": 0.2 },
      "rotation": [0, 0, -25], "mirror": true, "material": { "color": "skin" } } }
]`;
</script>

<svelte:head>
	<title>Clayform — a 3D workshop for AI agents</title>
	<meta
		name="description"
		content="Clayform lets AI agents model, rig, animate and export game-ready glTF by editing a scene document, looking at renders and reading critics. Open source, no Blender, no GPU."
	/>
</svelte:head>

<main id="main">
	<section class="lead">
		<p class="eyebrow">Open source · Node library and MCP server · Apache-2.0</p>
		<h1>Let your agent model, rig and animate in 3D, and see what it made.</h1>
		<p class="sub">
			The agent writes a scene in named parts ("ears on the head, left side"), looks at the renders Clayform draws for it, reads
			what the critics measured, and exports a rigged, animated glTF for Godot, Unity, Unreal or three.js. No Blender, no GPU.
		</p>
		<div class="install">
			<code aria-label="Install command">{INSTALL}</code>
			<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy the command'}</button>
		</div>
		<p class="then">
			Then ask for something: <em>"Make a goblin from the biped template, green skin, pointy ears, with a walk cycle."</em>
			<a href="/docs/getting-started">Getting started</a>
		</p>
	</section>

	<section class="sheet" aria-labelledby="sheet-title">
		<h2 id="sheet-title" class="visually-hidden">The templates</h2>
		<ul>
			{#each data.templates as t (t.id)}
				<li>
					<a href={`/docs/templates#${t.anchor}`} title={t.title}>
						<img src={t.src} alt={`${t.title}, rendered by Clayform`} width="256" height="256" loading="lazy" />
						<span>{t.id}</span>
					</a>
				</li>
			{/each}
		</ul>
		<p class="caption">
			{data.templates.length} templates, each passing every critic, all drawn by Clayform's own renderer. Agents start from the closest
			one and edit it.
		</p>
	</section>

	<section class="flow" aria-labelledby="flow-title">
		<h2 id="flow-title">One edit, four looks at it</h2>
		<ol>
			<li class="step">
				<div class="step-head"><span class="n">1</span><h3>The agent edits the scene</h3></div>
				<p>Parts attach to each other by side, so nothing floats. Mirrored parts make their own twin.</p>
				<pre><code>{edit}</code></pre>
			</li>
			<li class="step">
				<div class="step-head"><span class="n">2</span><h3>It looks, and it knows which part is which</h3></div>
				<p><code>render</code> returns the shaded model; <code>mode: "parts"</code> paints every part its own colour with a legend.</p>
				<div class="pair">
					<img src={data.shots.goblin} alt="The goblin, shaded, front and three-quarter views" loading="lazy" />
					<img src={data.shots.parts} alt="The goblin with each part in its own colour" loading="lazy" />
				</div>
			</li>
			<li class="step">
				<div class="step-head"><span class="n">3</span><h3>It animates by intent</h3></div>
				<p>
					<code>walk</code> finds the legs, plants the feet and swings the arms. The ears follow through on a spring. The export carries
					the walking speed so the feet stay put in your engine.
				</p>
				<img src={data.shots.walk} alt="Six frames of the goblin walking" loading="lazy" />
			</li>
			<li class="step">
				<div class="step-head"><span class="n">4</span><h3>It exports for the game</h3></div>
				<p>
					glTF with materials, a skin and every clip, reduced to a triangle budget, with LODs, convex colliders named for your engine,
					and a baked texture atlas if your engine ignores vertex colours. The Khronos validator checks every kind of export in the
					test suite.
				</p>
			</li>
		</ol>
	</section>

	<section class="actions" aria-labelledby="actions-title">
		<h2 id="actions-title">Game actions from roles</h2>
		<p>
			<code>attack</code>, <code>jump</code>, <code>sit</code>, <code>turn</code> and <code>die</code> work on any model with legs, arms or a
			head, because they are built from what each part is, not from keyframes.
		</p>
		<img src={data.shots.actions} alt="Film strips of the biped attacking, jumping, sitting, turning and falling over" loading="lazy" />
	</section>

	<section class="more" aria-labelledby="more-title">
		<h2 id="more-title">What else is in the box</h2>
		<dl>
			<div>
				<dt><a href="/docs/critics">Critics</a></dt>
				<dd>Floating parts, carves that split a model, detail too thin to mesh, colours that blend together, limbs that will stretch, feet that slide.</dd>
			</div>
			<div>
				<dt><a href="/docs/matching-a-reference">Matching a reference</a></dt>
				<dd>Fit the model to a sketch or photo: a score, an overlay, and which parts are too wide or narrow.</dd>
			</div>
			<div>
				<dt><a href="/docs/parts">Part library</a></dt>
				<dd>28 ready eyes, ears, horns, wings, wheels, doors and hats, placed with one edit.</dd>
			</div>
			<div>
				<dt><a href="/docs/layouts">Layouts</a></dt>
				<dd>Rows, grids, circles and scatters of models, checked for overlaps, exported as one scene.</dd>
			</div>
			<div>
				<dt><a href="/docs/export#kits">Kits</a></dt>
				<dd>A set of models painted from one shared texture, so an engine draws them all with one material.</dd>
			</div>
			<div>
				<dt><a href="/docs/mcp-tools#hosting-over-http">Hosting</a></dt>
				<dd>The same tools over HTTP, with a sandboxed workspace per session.</dd>
			</div>
		</dl>
		<p class="source">
			Read the <a href="/docs">documentation</a> or the <a href={REPO} rel="noopener">source on GitHub</a>.
		</p>
	</section>
</main>

<style>
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 var(--s5);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.lead {
		padding: var(--s9) 0 var(--s7);
		max-width: 880px;
	}
	.eyebrow {
		margin: 0 0 var(--s4);
		font-size: 14px;
		color: var(--ink-3);
	}
	h1 {
		margin: 0;
		font-size: clamp(34px, 5.2vw, 58px);
		line-height: 1.06;
		letter-spacing: -0.025em;
		font-weight: 700;
	}
	.sub {
		margin: var(--s5) 0 0;
		font-size: 19px;
		line-height: 1.55;
		color: var(--ink-2);
		max-width: 64ch;
	}
	.install {
		margin-top: var(--s6);
		display: flex;
		align-items: stretch;
		max-width: 760px;
		border: 1px solid var(--ink);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.install code {
		flex: 1;
		min-width: 0;
		padding: var(--s3) var(--s4);
		font-size: 15px;
		overflow-x: auto;
		white-space: nowrap;
		background: var(--paper);
		display: flex;
		align-items: center;
	}
	.install button {
		font: inherit;
		font-size: 15px;
		font-weight: 600;
		border: 0;
		border-left: 1px solid var(--ink);
		background: var(--blue);
		color: #fff;
		padding: 0 var(--s5);
		min-height: 48px;
		cursor: pointer;
		white-space: nowrap;
	}
	.install button:hover {
		background: #15317a;
	}
	.then {
		margin: var(--s4) 0 0;
		color: var(--ink-2);
		font-size: 15px;
	}
	.then em {
		font-style: normal;
		color: var(--ink);
	}
	.then a {
		margin-left: var(--s2);
		font-weight: 600;
	}

	/* the contact sheet: renders edge to edge, no card chrome */
	.sheet ul {
		list-style: none;
		margin: 0 calc(-1 * var(--s5));
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
		gap: 1px;
		background: var(--line);
		border-block: 1px solid var(--line);
	}
	.sheet li a {
		display: block;
		position: relative;
		background: #f3f3f1;
		text-decoration: none;
		border-radius: 0;
	}
	.sheet img {
		display: block;
		width: 100%;
		aspect-ratio: 1;
	}
	.sheet li span {
		position: absolute;
		left: 6px;
		bottom: 4px;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--ink-3);
	}
	.sheet li a:hover {
		background: var(--blue-wash);
	}
	.sheet li a:hover span {
		color: var(--ink);
	}
	.caption {
		margin: var(--s3) 0 0;
		font-size: 14px;
		color: var(--ink-3);
	}

	section h2 {
		font-size: 28px;
		letter-spacing: -0.015em;
		line-height: 1.2;
		margin: 0 0 var(--s5);
	}
	.flow {
		padding-top: var(--s9);
	}
	.flow ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--s7);
	}
	.step {
		border-left: 2px solid var(--line);
		padding-left: var(--s5);
	}
	.step-head {
		display: flex;
		align-items: baseline;
		gap: var(--s3);
	}
	.n {
		font-family: var(--mono);
		font-size: 13px;
		color: #fff;
		background: var(--blue);
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: inline-grid;
		place-items: center;
		margin-left: calc(-1 * var(--s5) - 13px);
		flex: none;
	}
	.step h3 {
		margin: 0;
		font-size: 20px;
		line-height: 1.3;
	}
	.step p {
		margin: var(--s2) 0 var(--s4);
		color: var(--ink-2);
		max-width: 70ch;
	}
	.step pre {
		margin: 0;
		background: var(--wash);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: var(--s4);
		overflow-x: auto;
		font-size: 13px;
		line-height: 1.55;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--s3);
	}
	.flow img,
	.actions img {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		display: block;
	}
	.actions,
	.more {
		padding-top: var(--s9);
	}
	.actions p {
		color: var(--ink-2);
		max-width: 70ch;
		margin: 0 0 var(--s5);
	}
	.more dl {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 0 var(--s7);
	}
	.more dl div {
		padding: var(--s4) 0;
		border-top: 1px solid var(--line);
	}
	.more dt {
		font-weight: 600;
		font-size: 17px;
	}
	.more dd {
		margin: var(--s1) 0 0;
		color: var(--ink-2);
	}
	.source {
		margin-top: var(--s6);
		color: var(--ink-2);
	}
	@media (max-width: 640px) {
		main {
			padding: 0 var(--s4);
		}
		.lead {
			padding-top: var(--s7);
		}
		.sheet ul {
			margin: 0 calc(-1 * var(--s4));
			grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		}
		.install {
			flex-direction: column;
		}
		.install code {
			white-space: normal;
			overflow-wrap: anywhere;
			line-height: 1.5;
		}
		.install button {
			border-left: 0;
			border-top: 1px solid var(--ink);
		}
		.n {
			margin-left: calc(-1 * var(--s5) - 13px);
		}
	}
</style>
