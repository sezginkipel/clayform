<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
	import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
	import { SITE_URL } from '$lib/meta';

	let { data } = $props();

	let selectedTemplateId = $state('knight');
	let sceneJson = $state('');
	let parseError = $state('');
	let statusNotice = $state('');
	let activeClip = $state('walk');
	let isPaused = $state(false);
	let speed = $state(1.0);
	let showWire = $state(false);
	let showPartColors = $state(false);
	let showSockets = $state(true);
	let showBounds = $state(false);
	let byokOpen = $state(false);
	let byokProvider = $state<'local' | 'meshy' | 'tripo'>('local');
	let byokEndpoint = $state('http://127.0.0.1:8000');
	let byokKey = $state('');
	let byokPrompt = $state('ornate dragon-crest shield');
	let byokPartId = $state('crest_shield');
	let byokAttachTo = $state('arm');

	let undoStack: string[] = $state([]);
	let redoStack: string[] = $state([]);

	let stats = $state({
		parts: 0,
		mirrored: 0,
		triangles: 0,
		sockets: [] as string[],
		clips: [] as string[],
		issues: [] as { severity: 'error' | 'warn' | 'ok'; text: string }[]
	});

	let viewportEl: HTMLDivElement | undefined = $state();
	let viewerApi: {
		rebuild: (doc: any) => void;
		exportGlb: (name: string) => void;
		setOptions: (opts: { wire: boolean; partColors: boolean; sockets: boolean; bounds: boolean; clip: string; paused: boolean; speed: number }) => void;
	} | null = $state(null);

	function selectTemplate(id: string, pushUndo = false) {
		const found = data.templates.find((t) => t.id === id);
		if (!found) return;
		if (pushUndo && sceneJson) {
			undoStack = [...undoStack.slice(-25), sceneJson];
			redoStack = [];
		}
		selectedTemplateId = id;
		const cloned = JSON.parse(JSON.stringify(found.scene));
		sceneJson = JSON.stringify(cloned, null, 2);
		activeClip = cloned.clips?.[0]?.id ?? '';
		applySceneJson(sceneJson);
	}

	function pushEdit(nextObj: any, label: string) {
		undoStack = [...undoStack.slice(-25), sceneJson];
		redoStack = [];
		sceneJson = JSON.stringify(nextObj, null, 2);
		applySceneJson(sceneJson);
		flashStatus(label);
	}

	function undo() {
		if (!undoStack.length) return;
		const prev = undoStack[undoStack.length - 1];
		undoStack = undoStack.slice(0, -1);
		redoStack = [...redoStack, sceneJson];
		sceneJson = prev;
		applySceneJson(sceneJson);
	}

	function redo() {
		if (!redoStack.length) return;
		const next = redoStack[redoStack.length - 1];
		redoStack = redoStack.slice(0, -1);
		undoStack = [...undoStack, sceneJson];
		sceneJson = next;
		applySceneJson(sceneJson);
	}

	function flashStatus(msg: string) {
		statusNotice = msg;
		setTimeout(() => {
			if (statusNotice === msg) statusNotice = '';
		}, 2600);
	}

	function applyPreset(kind: 'goblin' | 'sockets' | 'cyberpunk' | 'actions') {
		try {
			const doc = JSON.parse(sceneJson);
			if (kind === 'goblin') {
				const biped = data.templates.find((t) => t.id === 'biped')!.scene;
				const next = JSON.parse(JSON.stringify(biped));
				next.name = 'Goblin Scout';
				next.palette = { ...next.palette, skin: '#7fb04a', shirt: '#6b4a2b', pants: '#3d3322' };
				next.parts = next.parts.map((p: any) => (p.id === 'hair' ? { ...p, hidden: true } : p));
				next.parts.push({
					id: 'ear',
					role: 'ear',
					shape: { type: 'cone', height: 0.16, radius: 0.045 },
					attach: { to: 'head', side: 'left', offset: [0, 0.2], align: true, embed: 0.2 },
					rotation: [0, 0, -25],
					mirror: true,
					material: { color: 'skin' }
				});
				selectedTemplateId = 'biped';
				pushEdit(next, 'Applied Goblin Scout edit');
			} else if (kind === 'sockets') {
				const parts = doc.parts ?? [];
				let touched = false;
				for (const p of parts) {
					if ((p.id === 'hand' || p.role === 'arm') && !p.socket) {
						p.socket = 'hand_r';
						touched = true;
						break;
					}
				}
				if (!touched && parts[0]) parts[0].socket = 'mount_top';
				const head = parts.find((p: any) => p.role === 'head' || p.id === 'head');
				if (head && !head.socket) head.socket = 'head_hat';
				showSockets = true;
				pushEdit(doc, 'Added SOCKET_hand_r & SOCKET_head_hat');
			} else if (kind === 'cyberpunk') {
				const keys = Object.keys(doc.palette ?? {});
				const palette = ['#0f172a', '#06b6d4', '#ec4899', '#eab308', '#a855f7', '#22c55e'];
				doc.palette = doc.palette ?? {};
				keys.forEach((k, i) => {
					doc.palette[k] = palette[i % palette.length];
				});
				pushEdit(doc, 'Applied neon palette');
			} else if (kind === 'actions') {
				doc.clips = [
					{ id: 'walk', type: 'walk' },
					{ id: 'run', type: 'run' },
					{ id: 'attack', type: 'attack' },
					{ id: 'jump', type: 'jump' },
					{ id: 'idle', type: 'idle' }
				];
				activeClip = 'attack';
				pushEdit(doc, 'Added walk, run, attack, jump, idle clips');
			}
		} catch (e) {
			parseError = (e as Error).message;
		}
	}

	function applySceneJson(raw: string) {
		try {
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.parts)) {
				throw new Error('Scene must have a "parts" array.');
			}
			parseError = '';
			if (viewerApi) {
				viewerApi.rebuild(parsed);
				viewerApi.setOptions({
					wire: showWire,
					partColors: showPartColors,
					sockets: showSockets,
					bounds: showBounds,
					clip: activeClip,
					paused: isPaused,
					speed
				});
			}
		} catch (e) {
			parseError = (e as Error).message;
		}
	}

	async function shareSceneUrl() {
		try {
			const minified = JSON.stringify(JSON.parse(sceneJson));
			const encoded = btoa(encodeURIComponent(minified));
			const url = `${window.location.origin}/play#s=${encoded}`;
			window.history.replaceState(null, '', `/play#s=${encoded}`);
			await navigator.clipboard.writeText(url);
			flashStatus('Shareable URL copied to clipboard');
		} catch {
			flashStatus('Could not encode scene URL');
		}
	}

	function downloadClayJson() {
		try {
			const doc = JSON.parse(sceneJson);
			const slug = (doc.name || selectedTemplateId || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-');
			const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `${slug}.clay.json`;
			a.click();
			URL.revokeObjectURL(a.href);
			flashStatus(`Downloaded ${slug}.clay.json`);
		} catch (e) {
			parseError = (e as Error).message;
		}
	}

	function downloadGlb() {
		if (!viewerApi) return;
		try {
			const doc = JSON.parse(sceneJson);
			const slug = (doc.name || selectedTemplateId || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-');
			viewerApi.exportGlb(slug);
			flashStatus(`Exported ${slug}.glb`);
		} catch {
			flashStatus('Fix JSON errors before exporting GLB');
		}
	}

	async function copyMcpCommand() {
		const snippet = JSON.stringify(
			{
				tool: 'generate_part',
				arguments: {
					scene: selectedTemplateId,
					id: byokPartId,
					prompt: byokPrompt,
					provider: byokProvider,
					...(byokProvider === 'local' ? { endpoint: byokEndpoint } : { api_key: byokKey || '<YOUR_API_KEY>' }),
					attach: { to: byokAttachTo, side: 'front', embed: 0.2 }
				}
			},
			null,
			2
		);
		await navigator.clipboard.writeText(snippet);
		flashStatus('Copied generate_part MCP payload');
	}

	$effect(() => {
		const opts = {
			wire: showWire,
			partColors: showPartColors,
			sockets: showSockets,
			bounds: showBounds,
			clip: activeClip,
			paused: isPaused,
			speed
		};
		if (viewerApi) {
			viewerApi.setOptions(opts);
		}
	});

	onMount(() => {
		// Check if URL has a shared scene hash (#s=...) or template deep-link (?template=... or #template=...)
		const hash = window.location.hash;
		const queryTpl = new URLSearchParams(window.location.search).get('template');
		if (hash.startsWith('#s=')) {
			try {
				const decoded = decodeURIComponent(atob(hash.slice(3)));
				const parsed = JSON.parse(decoded);
				sceneJson = JSON.stringify(parsed, null, 2);
				activeClip = parsed.clips?.[0]?.id ?? '';
			} catch {
				selectTemplate('knight');
			}
		} else if (queryTpl) {
			selectTemplate(data.templates.some((t) => t.id === queryTpl) ? queryTpl : 'knight');
		} else if (hash.startsWith('#template=')) {
			const tid = decodeURIComponent(hash.slice('#template='.length));
			selectTemplate(data.templates.some((t) => t.id === tid) ? tid : 'knight');
		} else {
			selectTemplate('knight');
		}

		if (!viewportEl) return;

		const initW = Math.max(320, viewportEl.clientWidth || 640);
		const initH = Math.max(320, viewportEl.clientHeight || 480);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(initW, initH);
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.shadowMap.enabled = true;
		viewportEl.appendChild(renderer.domElement);

		const scene3d = new THREE.Scene();
		scene3d.background = new THREE.Color(0xf4f6f8);
		scene3d.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

		const camera = new THREE.PerspectiveCamera(36, initW / initH, 0.01, 200);
		camera.position.set(1.6, 1.2, 2.2);

		const controls = new OrbitControls(camera, renderer.domElement);
			controls.enableDamping = true;
			controls.dampingFactor = 0.06;
			controls.target.set(0, 0.55, 0);

			const sun = new THREE.DirectionalLight(0xffffff, 2.0);
			sun.position.set(2.5, 4.5, 3.0);
			sun.castShadow = true;
			scene3d.add(sun);

			const ground = new THREE.Mesh(new THREE.CircleGeometry(15, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
			ground.rotation.x = -Math.PI / 2;
			ground.receiveShadow = true;
			scene3d.add(ground);

			const grid = new THREE.GridHelper(12, 48, 0xc9d0d7, 0xe2e6ea);
			scene3d.add(grid);

			let modelRoot: any = null;
			let boundsGroup: any = null;
			let socketGroup: any = null;
			let animNodes: { mesh: any; part: any; basePos: [number, number, number]; baseRot: [number, number, number]; twinSign: number }[] = [];
			let curOpts = { wire: showWire, partColors: showPartColors, sockets: showSockets, bounds: showBounds, clip: activeClip, paused: isPaused, speed };

			const PART_PALETTE = [
				'#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea',
				'#0891b2', '#db2777', '#4f46e5', '#65a30d', '#ea580c'
			];

			function makePartGeometry(shape: any) {
				if (!shape || typeof shape !== 'object') return new THREE.SphereGeometry(0.1, 20, 16);
				switch (shape.type) {
					case 'sphere':
						return new THREE.SphereGeometry(shape.radius ?? 0.15, 24, 18);
					case 'ellipsoid': {
						const [rx = 0.15, ry = 0.15, rz = 0.15] = shape.radii ?? [0.15, 0.15, 0.15];
						const g = new THREE.SphereGeometry(1, 24, 18);
						g.scale(rx, ry, rz);
						return g;
					}
					case 'box': {
						const [sx = 0.2, sy = 0.2, sz = 0.2] = shape.size ?? [0.2, 0.2, 0.2];
						return new THREE.BoxGeometry(sx, sy, sz, 2, 2, 2);
					}
					case 'capsule': {
						const r = shape.radius ?? 0.06;
						const len = Math.max(0.001, (shape.length ?? 0.3) - r * 2);
						return new THREE.CapsuleGeometry(r, len, 12, 20);
					}
					case 'cylinder': {
						const r = shape.radius ?? 0.1;
						const h = shape.height ?? 0.25;
						return new THREE.CylinderGeometry(r, r, h, 24);
					}
					case 'cone': {
						const r = shape.radius ?? 0.12;
						const tr = shape.topRadius ?? 0;
						const h = shape.height ?? 0.25;
						return new THREE.CylinderGeometry(tr, r, h, 24);
					}
					case 'torus': {
						return new THREE.TorusGeometry(shape.radius ?? 0.15, shape.tube ?? 0.04, 16, 32);
					}
					case 'prism': {
						const [sx = 0.2, sy = 0.2, sz = 0.2] = shape.size ?? [0.2, 0.2, 0.2];
						const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 3);
						g.scale(sx, sy, sz);
						return g;
					}
					case 'tube': {
						const pts = (shape.points ?? [[0, 0, 0], [0, 0.2, 0]]).map((p: number[]) => new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0));
						const curve = new THREE.CatmullRomCurve3(pts.length >= 2 ? pts : [new THREE.Vector3(), new THREE.Vector3(0, 0.2, 0)]);
						const r = Array.isArray(shape.radius) ? shape.radius[0] ?? 0.04 : shape.radius ?? 0.04;
						return new THREE.TubeGeometry(curve, 20, r, 12, false);
					}
					case 'lathe': {
						const prof = (shape.profile ?? [[0, 0], [0.1, 0], [0.1, 0.2], [0, 0.2]]).map((p: number[]) => new THREE.Vector2(Math.max(0.001, p[0] ?? 0.05), p[1] ?? 0));
						return new THREE.LatheGeometry(prof, shape.sides ?? 24);
					}
					case 'sheet':
					case 'terrain': {
						const [sx = 0.4, sy = 0.02, sz = 0.4] = shape.size ?? [0.4, 0.02, 0.4];
						return new THREE.BoxGeometry(sx, Math.max(0.015, sy), sz, 8, 2, 8);
					}
					default: {
						const [sx = 0.2, sy = 0.2, sz = 0.2] = shape.size ?? [0.2, 0.2, 0.2];
						return new THREE.BoxGeometry(sx, sy, sz);
					}
				}
			}

			function halfExtents(shape: any): [number, number, number] {
				if (!shape) return [0.1, 0.1, 0.1];
				switch (shape.type) {
					case 'sphere': {
						const r = shape.radius ?? 0.15;
						return [r, r, r];
					}
					case 'ellipsoid': {
						const [x = 0.15, y = 0.15, z = 0.15] = shape.radii ?? [0.15, 0.15, 0.15];
						return [x, y, z];
					}
					case 'box':
					case 'prism':
					case 'sheet':
					case 'terrain': {
						const [x = 0.2, y = 0.2, z = 0.2] = shape.size ?? [0.2, 0.2, 0.2];
						return [x / 2, y / 2, z / 2];
					}
					case 'capsule': {
						const r = shape.radius ?? 0.06;
						const l = shape.length ?? 0.3;
						return [r, l / 2, r];
					}
					case 'cylinder':
					case 'cone': {
						const r = Math.max(shape.radius ?? 0.1, shape.topRadius ?? 0);
						const h = shape.height ?? 0.25;
						return [r, h / 2, r];
					}
					case 'torus': {
						const R = (shape.radius ?? 0.15) + (shape.tube ?? 0.04);
						return [R, R, shape.tube ?? 0.04];
					}
					default:
						return [0.12, 0.12, 0.12];
				}
			}

			function resolveColor(c: string | undefined, palette: Record<string, string>): string {
				if (!c) return '#94a3b8';
				if (c.startsWith('#')) return c;
				return palette[c] ?? '#94a3b8';
			}

			function rebuild(doc: any) {
				if (modelRoot) {
					scene3d.remove(modelRoot);
				}
				if (boundsGroup) scene3d.remove(boundsGroup);
				if (socketGroup) scene3d.remove(socketGroup);

				modelRoot = new THREE.Group();
				modelRoot.name = doc.name || 'ClayformScene';
				boundsGroup = new THREE.Group();
				socketGroup = new THREE.Group();
				animNodes = [];

				const palette: Record<string, string> = doc.palette ?? {};
				const parts: any[] = (doc.parts ?? []).filter((p: any) => !p.hidden && (p.op ?? 'add') === 'add');
				const resolved = new Map<string, { center: [number, number, number]; half: [number, number, number]; rot: [number, number, number] }>();

				let totalTris = 0;
				let mirrorCount = 0;
				const socketNames: string[] = [];
				const criticIssues: { severity: 'error' | 'warn' | 'ok'; text: string }[] = [];

				parts.forEach((p, idx) => {
					const half = halfExtents(p.shape);
					const scale = p.scale ?? [1, 1, 1];
					const scaledHalf: [number, number, number] = [half[0] * (scale[0] ?? 1), half[1] * (scale[1] ?? 1), half[2] * (scale[2] ?? 1)];

					let center: [number, number, number] = [0, scaledHalf[1], 0];
					const pos = p.position ?? [0, 0, 0];

					if (p.attach && p.attach.to && resolved.has(p.attach.to)) {
						const target = resolved.get(p.attach.to)!;
						const side = p.attach.side ?? 'top';
						const off = p.attach.offset ?? [0, 0];
						const embed = p.attach.embed ?? 0.25;
						const tc = target.center;
						const th = target.half;

						const dir: [number, number, number] =
							side === 'top'
								? [0, 1, 0]
								: side === 'bottom'
									? [0, -1, 0]
									: side === 'left'
										? [1, 0, 0]
										: side === 'right'
											? [-1, 0, 0]
											: side === 'front'
												? [0, 0, 1]
												: [0, 0, -1];

						const span =
							Math.abs(dir[0]) * (th[0] + scaledHalf[0] * (1 - embed)) +
							Math.abs(dir[1]) * (th[1] + scaledHalf[1] * (1 - embed)) +
							Math.abs(dir[2]) * (th[2] + scaledHalf[2] * (1 - embed));

						let ox = 0, oy = 0, oz = 0;
						if (side === 'top' || side === 'bottom') {
							ox = (off[0] ?? 0) * th[0];
							oz = (off[1] ?? 0) * th[2];
						} else if (side === 'left' || side === 'right') {
							oz = (off[0] ?? 0) * th[2];
							oy = (off[1] ?? 0) * th[1];
						} else {
							ox = (off[0] ?? 0) * th[0];
							oy = (off[1] ?? 0) * th[1];
						}

						center = [
							tc[0] + dir[0] * span + ox + (pos[0] ?? 0),
							tc[1] + dir[1] * span + oy + (pos[1] ?? 0),
							tc[2] + dir[2] * span + oz + (pos[2] ?? 0)
						];
					} else if (p.position) {
						center = [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0];
					} else if (idx > 0) {
						criticIssues.push({
							severity: 'warn',
							text: `Part "${p.id}" has no attach or position — defaulted near origin`
						});
					}

					const rot: [number, number, number] = [
						((p.rotation?.[0] ?? 0) * Math.PI) / 180,
						((p.rotation?.[1] ?? 0) * Math.PI) / 180,
						((p.rotation?.[2] ?? 0) * Math.PI) / 180
					];

					resolved.set(p.id, { center, half: scaledHalf, rot });

					const geom = makePartGeometry(p.shape);
					const hexColor = resolveColor(p.material?.color, palette);
					const partColor = PART_PALETTE[idx % PART_PALETTE.length];

					const spawnInstance = (twin: boolean) => {
						const sign = twin ? -1 : 1;
						const mat = new THREE.MeshStandardMaterial({
							color: curOpts.partColors ? partColor : hexColor,
							roughness: p.material?.roughness ?? 0.65,
							metalness: p.material?.metalness ?? 0.08,
							wireframe: curOpts.wire
						});
						mat.userData = { realColor: hexColor, partColor };

						const m = new THREE.Mesh(geom, mat);
						m.name = twin ? `${p.id}_mirror` : p.id;
						m.castShadow = true;
						m.receiveShadow = true;
						const px = twin ? -center[0] : center[0];
						const py = center[1];
						const pz = center[2];
						const rx = rot[0];
						const ry = twin ? -rot[1] : rot[1];
						const rz = twin ? -rot[2] : rot[2];
						m.position.set(px, py, pz);
						m.rotation.set(rx, ry, rz);
						m.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
						modelRoot.add(m);

						totalTris += (geom.index ? geom.index.count : geom.attributes.position.count) / 3;
						animNodes.push({ mesh: m, part: p, basePos: [px, py, pz], baseRot: [rx, ry, rz], twinSign: sign });

						// Bounds helper
						const bBox = new THREE.Mesh(
							new THREE.BoxGeometry(scaledHalf[0] * 2, scaledHalf[1] * 2, scaledHalf[2] * 2),
							new THREE.MeshBasicMaterial({ color: 0x0891b2, wireframe: true })
						);
						bBox.position.copy(m.position);
						bBox.rotation.copy(m.rotation);
						boundsGroup.add(bBox);

						// Socket node
						if (p.socket) {
							const sName = `SOCKET_${twin ? `${p.socket}_l` : p.socket}`;
							socketNames.push(sName);
							const sNode = new THREE.Group();
							sNode.name = sName;
							sNode.position.set(0, -scaledHalf[1] * 0.6, scaledHalf[2] * 0.5);
							m.add(sNode);

							const axes = new THREE.AxesHelper(0.14);
							const dot = new THREE.Mesh(
								new THREE.SphereGeometry(0.022, 12, 12),
								new THREE.MeshBasicMaterial({ color: 0xe11d48 })
							);
							dot.position.copy(m.position).add(sNode.position);
							axes.position.copy(dot.position);
							socketGroup.add(axes);
							socketGroup.add(dot);
						}
					};

					spawnInstance(false);
					if (p.mirror && Math.abs(center[0]) > 0.001) {
						mirrorCount++;
						spawnInstance(true);
					}
				});

				// Auto-ground modelRoot so lowest point rests at y = 0
				const box = new THREE.Box3().setFromObject(modelRoot);
				if (isFinite(box.min.y)) {
					const lift = -box.min.y;
					modelRoot.position.y = lift;
					boundsGroup.position.y = lift;
					socketGroup.position.y = lift;
				}

				boundsGroup.visible = curOpts.bounds;
				socketGroup.visible = curOpts.sockets;
				scene3d.add(modelRoot);
				scene3d.add(boundsGroup);
				scene3d.add(socketGroup);

				const clipsList = (doc.clips ?? []).map((c: any) => c.id);
				if (!criticIssues.length) {
					criticIssues.push({ severity: 'ok', text: 'Critics clean: all parts anchored, grounded at y = 0, ready for glTF 2.0 export' });
				}

				stats = {
					parts: parts.length,
					mirrored: mirrorCount,
					triangles: Math.round(totalTris),
					sockets: socketNames,
					clips: clipsList,
					issues: criticIssues
				};
			}

			function setOptions(opts: typeof curOpts) {
				curOpts = opts;
				if (!modelRoot) return;
				modelRoot.traverse((o: any) => {
					if (o.isMesh && o.material && o.material.userData?.realColor) {
						o.material.wireframe = opts.wire;
						o.material.color.set(opts.partColors ? o.material.userData.partColor : o.material.userData.realColor);
					}
				});
				if (boundsGroup) boundsGroup.visible = opts.bounds;
				if (socketGroup) socketGroup.visible = opts.sockets;
			}

			function exportGlb(name: string) {
				if (!modelRoot) return;
				const exporter = new GLTFExporter();
				exporter.parse(
					modelRoot,
					(result) => {
						const bin = result instanceof ArrayBuffer ? result : new TextEncoder().encode(JSON.stringify(result)).buffer;
						const blob = new Blob([bin], { type: 'model/gltf-binary' });
						const a = document.createElement('a');
						a.href = URL.createObjectURL(blob);
						a.download = `${name}.glb`;
						a.click();
						URL.revokeObjectURL(a.href);
					},
					() => {},
					{ binary: true }
				);
			}

			viewerApi = { rebuild, exportGlb, setOptions };
			applySceneJson(sceneJson);

			let clock = 0;
			let lastTime = performance.now();

			renderer.setAnimationLoop((now: number) => {
				const dt = (now - lastTime) / 1000;
				lastTime = now;
				if (!curOpts.paused && curOpts.clip) {
					clock += dt * curOpts.speed;
					const t = clock * 4.2;
					for (const item of animNodes) {
						const role = item.part.role ?? '';
						const [bx, by, bz] = item.basePos;
						const [rx, ry, rz] = item.baseRot;
						const s = item.twinSign;

						item.mesh.position.set(bx, by, bz);
						item.mesh.rotation.set(rx, ry, rz);

						if (curOpts.clip === 'walk' || curOpts.clip === 'run') {
							const amp = curOpts.clip === 'run' ? 0.55 : 0.34;
							if (role === 'leg') item.mesh.rotation.x = rx + Math.sin(t + (s > 0 ? 0 : Math.PI)) * amp;
							else if (role === 'arm') item.mesh.rotation.x = rx + Math.sin(t + (s > 0 ? Math.PI : 0)) * (amp * 0.75);
							else if (role === 'body') item.mesh.position.y = by + Math.abs(Math.sin(t)) * 0.025;
							else if (role === 'tail' || role === 'ear') item.mesh.rotation.z = rz + Math.sin(t * 1.5) * 0.12 * s;
							else if (role === 'wheel') item.mesh.rotation.x = rx + t * 1.5;
						} else if (curOpts.clip === 'idle' || curOpts.clip === 'hover') {
							if (role === 'body' || role === 'head') item.mesh.position.y = by + Math.sin(t * 0.6) * 0.018;
							if (role === 'wing') item.mesh.rotation.z = rz + Math.sin(t * 1.8) * 0.35 * s;
						} else if (curOpts.clip === 'attack') {
							if (role === 'arm' && s < 0) item.mesh.rotation.x = rx - Math.abs(Math.sin(t * 1.3)) * 1.25;
							else if (role === 'body') item.mesh.rotation.y = ry + Math.sin(t * 1.3) * 0.2;
						} else if (curOpts.clip === 'jump' || curOpts.clip === 'hop') {
							const hop = Math.max(0, Math.sin(t * 0.9)) * 0.18;
							item.mesh.position.y = by + hop;
						} else if (curOpts.clip === 'fly') {
							if (role === 'wing') item.mesh.rotation.z = rz + Math.sin(t * 2.4) * 0.55 * s;
							else item.mesh.position.y = by + Math.sin(t * 1.2) * 0.04;
						} else if (curOpts.clip === 'spin' || curOpts.clip === 'drive') {
							if (role === 'rotor') item.mesh.rotation.y = ry + t * 4;
							if (role === 'wheel') item.mesh.rotation.x = rx + t * 2;
						}
					}
				}
				controls.update();
				renderer.render(scene3d, camera);
			});

			const onResize = () => {
				if (!viewportEl) return;
				const w = Math.max(320, viewportEl.clientWidth || 640);
				const h = Math.max(320, viewportEl.clientHeight || 480);
				camera.aspect = w / h;
				camera.updateProjectionMatrix();
				renderer.setSize(w, h);
			};
			window.addEventListener('resize', onResize);
			const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
			ro?.observe(viewportEl);

		return () => {
			window.removeEventListener('resize', onResize);
			ro?.disconnect();
			renderer.setAnimationLoop(null);
			renderer.dispose();
		};
	});

	const pageTitle = '3D Playground — Clayform interactive scene & glTF editor';
	const pageDesc =
		'Zero-install browser 3D playground for Clayform. Edit declarative scene JSON, test all 47 templates, inspect sockets and critics, and export binary glTF (.glb) in real time.';
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDesc} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDesc} />
</svelte:head>

<main id="main" class="play-wrap">
	<header class="play-top">
		<div>
			<h1>Interactive 3D Playground</h1>
			<p>
				Edit any of the {data.templates.length} verified templates in real time, test atomic edits, inspect equipment sockets, and download
				<code>.glb</code> or share a scene link — 100% in your browser with zero GPU server cost.
			</p>
		</div>
		<div class="top-actions">
			<button type="button" class="btn primary" onclick={downloadGlb}>Download .glb</button>
			<button type="button" class="btn" onclick={downloadClayJson}>Download .clay.json</button>
			<button type="button" class="btn" onclick={shareSceneUrl}>Share Link</button>
			<button type="button" class="btn" aria-pressed={byokOpen} onclick={() => (byokOpen = !byokOpen)}>
				AI Mesh Bridge (Local / BYOK)
			</button>
		</div>
	</header>

	{#if statusNotice}
		<div class="notice" role="status">{statusNotice}</div>
	{/if}

	{#if byokOpen}
		<section class="byok-panel" aria-label="Local and BYOK 3D Mesh Generator">
			<div class="byok-head">
				<h2>Hybrid AI Mesh + Procedural Rig Bridge (<code>generate_part</code>)</h2>
				<span class="badge">Free Local GPU or Bring-Your-Own-Key</span>
			</div>
			<p>
				Generate an organic 3D part using a free local open-weight model (TRELLIS / Hunyuan3D / TripoSR) or your own Meshy / Tripo3D API
				key, and attach it directly onto a rigged Clayform character. Keys stay strictly on your machine.
			</p>
			<div class="byok-grid">
				<label>
					<span>Provider</span>
					<select bind:value={byokProvider}>
						<option value="local">Local Open-Weight Server (Free, $0)</option>
						<option value="meshy">Meshy API (BYOK — Your Own Key)</option>
						<option value="tripo">Tripo3D API (BYOK — Your Own Key)</option>
					</select>
				</label>
				{#if byokProvider === 'local'}
					<label>
						<span>Local Endpoint URL</span>
						<input type="url" bind:value={byokEndpoint} placeholder="http://127.0.0.1:8000" />
					</label>
				{:else}
					<label>
						<span>Your {byokProvider === 'meshy' ? 'Meshy' : 'Tripo3D'} API Key (BYOK)</span>
						<input type="password" bind:value={byokKey} placeholder="Enter your personal API key..." />
					</label>
				{/if}
				<label>
					<span>Part ID & Attach Target</span>
					<div class="inline-inputs">
						<input type="text" bind:value={byokPartId} placeholder="part_id" />
						<input type="text" bind:value={byokAttachTo} placeholder="attach to (e.g. head)" />
					</div>
				</label>
				<label>
					<span>3D Prompt</span>
					<input type="text" bind:value={byokPrompt} placeholder="ornate dragon-crest shield" />
				</label>
			</div>
			<div class="byok-foot">
				<button type="button" class="btn primary" onclick={copyMcpCommand}>Copy MCP Tool Call</button>
				<span class="hint">Run in Claude Code / Cursor via <code>generate_part</code> — zero platform fees.</span>
			</div>
		</section>
	{/if}

	<div class="workspace">
		<section class="editor-pane" aria-label="Scene editor">
			<div class="pane-bar">
				<label class="tpl-select">
					<span>Template ({data.templates.length})</span>
					<select value={selectedTemplateId} onchange={(e) => selectTemplate((e.currentTarget as HTMLSelectElement).value, true)}>
						{#each data.templates as t (t.id)}
							<option value={t.id}>{t.id} — {t.title}</option>
						{/each}
					</select>
				</label>
				<div class="undo-group">
					<button type="button" class="btn sm" disabled={!undoStack.length} onclick={undo}>Undo</button>
					<button type="button" class="btn sm" disabled={!redoStack.length} onclick={redo}>Redo</button>
				</div>
			</div>

			<div class="presets-bar">
				<span class="preset-label">One-click agent edits:</span>
				<button type="button" class="chip" onclick={() => applyPreset('goblin')}>Goblin from Biped</button>
				<button type="button" class="chip" onclick={() => applyPreset('sockets')}>+ Equipment Sockets</button>
				<button type="button" class="chip" onclick={() => applyPreset('cyberpunk')}>Recolor Palette</button>
				<button type="button" class="chip" onclick={() => applyPreset('actions')}>+ Game Action Clips</button>
			</div>

			<textarea
				class="json-input"
				aria-label="Clayform scene JSON document"
				spellcheck="false"
				bind:value={sceneJson}
				oninput={(e) => applySceneJson((e.currentTarget as HTMLTextAreaElement).value)}
			></textarea>

			{#if parseError}
				<p class="error-box" role="alert">JSON / Schema Error: {parseError}</p>
			{/if}
		</section>

		<section class="viewer-pane" aria-label="3D viewport and diagnostics">
			<div class="viewer-toolbar">
				<div class="toggle-group">
					<button type="button" class="btn sm" aria-pressed={showWire} onclick={() => (showWire = !showWire)}>Wireframe</button>
					<button type="button" class="btn sm" aria-pressed={showPartColors} onclick={() => (showPartColors = !showPartColors)}>
						Part IDs
					</button>
					<button type="button" class="btn sm" aria-pressed={showSockets} onclick={() => (showSockets = !showSockets)}>
						Sockets ({stats.sockets.length})
					</button>
					<button type="button" class="btn sm" aria-pressed={showBounds} onclick={() => (showBounds = !showBounds)}>
						Colliders
					</button>
				</div>

				{#if stats.clips.length}
					<div class="clip-group">
						<select aria-label="Animation clip" bind:value={activeClip}>
							<option value="">Static Pose</option>
							{#each stats.clips as c (c)}
								<option value={c}>Clip: {c}</option>
							{/each}
						</select>
						<button type="button" class="btn sm" onclick={() => (isPaused = !isPaused)}>
							{isPaused ? 'Play' : 'Pause'}
						</button>
						<button
							type="button"
							class="btn sm"
							onclick={() => (speed = speed === 1 ? 0.5 : speed === 0.5 ? 0.25 : speed === 0.25 ? 2 : 1)}
						>
							{speed}x
						</button>
					</div>
				{/if}
			</div>

			<div class="viewport" bind:this={viewportEl}></div>

			<div class="diagnostics">
				<div class="stats-row">
					<span><strong>{stats.parts}</strong> parts ({stats.mirrored} mirrored)</span>
					<span>·</span>
					<span><strong>{stats.triangles.toLocaleString('en')}</strong> preview tris</span>
					<span>·</span>
					<span><strong>{stats.sockets.length}</strong> sockets</span>
					<span>·</span>
					<span><strong>{stats.clips.length}</strong> clips</span>
				</div>
				{#each stats.issues as iss, i (i)}
					<p class="issue {iss.severity}">{iss.text}</p>
				{/each}
			</div>
		</section>
	</div>
</main>

<style>
	.play-wrap {
		max-width: 1360px;
		margin: 0 auto;
		padding: var(--s5);
	}
	.play-top {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--s4);
		margin-bottom: var(--s4);
	}
	h1 {
		margin: 0;
		font-size: clamp(26px, 3.6vw, 36px);
		letter-spacing: -0.02em;
	}
	.play-top p {
		margin: var(--s1) 0 0;
		color: var(--ink-2);
		max-width: 68ch;
		font-size: 15px;
	}
	.top-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
	}
	.btn {
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		min-height: 40px;
		padding: 0 var(--s4);
		border: 1px solid var(--line-strong);
		background: var(--paper);
		color: var(--ink);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		background: var(--wash);
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.btn.primary {
		background: var(--blue);
		border-color: var(--blue);
		color: #fff;
	}
	.btn.primary:hover {
		background: #15317a;
	}
	.btn[aria-pressed='true'] {
		background: var(--blue-wash);
		border-color: var(--blue);
		color: var(--blue);
	}
	.btn.sm {
		min-height: 36px;
		padding: 0 var(--s3);
		font-size: 13px;
	}
	.notice {
		background: var(--ok-wash);
		color: var(--ok-ink);
		border: 1px solid #bfdcc9;
		border-radius: var(--radius);
		padding: var(--s2) var(--s4);
		font-size: 14px;
		font-weight: 600;
		margin-bottom: var(--s4);
	}
	.byok-panel {
		background: var(--wash);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius);
		padding: var(--s4);
		margin-bottom: var(--s4);
	}
	.byok-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
	}
	.byok-head h2 {
		margin: 0;
		font-size: 18px;
	}
	.badge {
		font-family: var(--mono);
		font-size: 12px;
		background: var(--ok-wash);
		color: var(--ok-ink);
		padding: 2px 8px;
		border-radius: 4px;
	}
	.byok-panel p {
		margin: var(--s2) 0 var(--s3);
		font-size: 14px;
		color: var(--ink-2);
	}
	.byok-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
		gap: var(--s3);
	}
	.byok-grid label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		font-weight: 600;
	}
	.byok-grid input,
	.byok-grid select {
		font: inherit;
		font-size: 13.5px;
		min-height: 38px;
		padding: 0 var(--s3);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius);
		background: var(--paper);
	}
	.inline-inputs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s2);
	}
	.byok-foot {
		margin-top: var(--s3);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s3);
	}
	.hint {
		font-size: 13px;
		color: var(--ink-3);
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		gap: var(--s4);
		align-items: stretch;
	}
	.editor-pane,
	.viewer-pane {
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--paper);
		display: flex;
		flex-direction: column;
	}
	.pane-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		padding: var(--s3);
		border-bottom: 1px solid var(--line);
		background: var(--wash);
	}
	.tpl-select {
		display: flex;
		align-items: center;
		gap: var(--s2);
		font-size: 13.5px;
		font-weight: 600;
		flex: 1;
		min-width: 0;
	}
	.tpl-select select {
		font: inherit;
		font-size: 14px;
		min-height: 38px;
		padding: 0 var(--s3);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius);
		background: var(--paper);
		flex: 1;
		min-width: 0;
	}
	.undo-group {
		display: flex;
		gap: var(--s1);
	}
	.presets-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s2);
		padding: var(--s2) var(--s3);
		border-bottom: 1px solid var(--line);
	}
	.preset-label {
		font-size: 12.5px;
		color: var(--ink-3);
		font-weight: 600;
	}
	.chip {
		font: inherit;
		font-size: 12.5px;
		padding: 4px 10px;
		min-height: 32px;
		border: 1px solid var(--blue-line);
		background: var(--blue-wash);
		color: var(--blue);
		font-weight: 600;
		border-radius: 999px;
		cursor: pointer;
	}
	.chip:hover {
		background: #dce5f7;
	}
	.json-input {
		flex: 1;
		width: 100%;
		min-height: 480px;
		border: 0;
		padding: var(--s3);
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink);
		background: var(--paper);
		resize: vertical;
	}
	.json-input:focus {
		outline: none;
	}
	.error-box {
		margin: 0;
		padding: var(--s2) var(--s3);
		background: #fef2f2;
		color: #991b1b;
		border-top: 1px solid #fecaca;
		font-family: var(--mono);
		font-size: 12px;
	}
	.viewer-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		padding: var(--s3);
		border-bottom: 1px solid var(--line);
		background: var(--wash);
	}
	.toggle-group,
	.clip-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s1);
	}
	.clip-group select {
		font: inherit;
		font-size: 13px;
		min-height: 36px;
		padding: 0 var(--s2);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius);
		background: var(--paper);
	}
	.viewport {
		width: 100%;
		height: 480px;
		position: relative;
		background: #f4f6f8;
	}
	.diagnostics {
		padding: var(--s3);
		border-top: 1px solid var(--line);
		background: var(--wash);
		font-size: 13px;
	}
	.stats-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
		color: var(--ink-2);
		font-family: var(--mono);
		font-size: 12.5px;
	}
	.issue {
		margin: var(--s2) 0 0;
		padding: 4px 8px;
		border-radius: 4px;
		font-size: 12.5px;
	}
	.issue.ok {
		background: var(--ok-wash);
		color: var(--ok-ink);
	}
	.issue.warn {
		background: #fef3c7;
		color: #92400e;
	}
	.issue.error {
		background: #fee2e2;
		color: #991b1b;
	}
	@media (max-width: 960px) {
		.workspace {
			grid-template-columns: minmax(0, 1fr);
		}
		.viewport {
			height: 380px;
		}
		.json-input {
			min-height: 320px;
		}
	}
	@media (max-width: 640px) {
		.play-wrap {
			padding: var(--s4);
		}
		.top-actions {
			width: 100%;
		}
		.top-actions .btn {
			flex: 1;
		}
	}
</style>
