/**
 * `clayform view <scene|template|file.glb>` — a local page that shows the
 * exported GLB in three.js and plays its clips. For people checking what an
 * agent made; the agent itself uses the software renderer.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PAGE = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Clayform</title>
<style>
  :root { --bg: #f4f3f0; --ink: #2b2b30; --muted: #6b6b72; --line: #dedbd5; --accent: #1f4e8c; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, sans-serif; }
  #app { position: fixed; inset: 0; }
  header { position: fixed; top: 12px; left: 12px; right: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; pointer-events: none; }
  header > * { pointer-events: auto; }
  h1 { font-size: 14px; font-weight: 600; margin: 0 8px 0 0; }
  button { font: inherit; border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 6px; padding: 5px 10px; cursor: pointer; }
  button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  #stats { color: var(--muted); margin-left: auto; }
  #error { position: fixed; bottom: 16px; left: 16px; right: 16px; color: #8c1f1f; }
</style>
</head>
<body>
<div id="app"></div>
<header><h1>${title}</h1><span id="clips"></span><button id="wire">Show wireframe</button><span id="stats"></span></header>
<p id="error" role="alert"></p>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const el = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
el.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f3f0);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 200);
const controls = new OrbitControls(camera, renderer.domElement);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
sun.castShadow = true;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(20, 80, 0xdedbd5, 0xe8e6e1));
const clock = new THREE.Clock();
let mixer = null;
let current = null, root = null, version = null;
function load(first) {
  new GLTFLoader().load('/model.glb?v=' + Date.now(), (gltf) => {
    if (root) { scene.remove(root); if (mixer) mixer.stopAllAction(); }
    root = gltf.scene;
    let tris = 0;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    scene.add(root);
    if (first) {
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z);
      camera.position.set(c.x + r * 1.3, c.y + r * 0.8, c.z + r * 1.8);
      controls.target.copy(c);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -r * 2;
      sun.shadow.camera.right = sun.shadow.camera.top = r * 2;
    }
    document.getElementById('stats').textContent = Math.round(tris).toLocaleString() + ' triangles · ' + gltf.animations.length + ' clips' + (first ? '' : ' · updated ' + new Date().toLocaleTimeString());
    document.getElementById('error').textContent = '';
    const bar = document.getElementById('clips');
    const playing = current ? current.name : null;
    bar.replaceChildren();
    current = null;
    mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    gltf.animations.forEach((clip, i) => {
      const b = document.createElement('button');
      b.textContent = 'Play ' + clip.name;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => {
        if (current) { current.action.stop(); current.button.setAttribute('aria-pressed', 'false'); }
        const action = mixer.clipAction(clip); action.play();
        current = { action, button: b, name: clip.name }; b.setAttribute('aria-pressed', 'true');
      };
      bar.appendChild(b);
      if (playing ? clip.name === playing : i === 0) b.click();
    });
  }, undefined, (e) => { document.getElementById('error').textContent = 'Could not load the model: ' + (e.message || e) + '. Check the terminal running clayform view.'; });
}
load(true);
// live reload: the server bumps a version when the scene file changes
setInterval(async () => {
  try {
    const r = await (await fetch('/version', { cache: 'no-store' })).json();
    if (r.error) document.getElementById('error').textContent = 'The scene has an error, showing the last good version: ' + r.error;
    if (version !== null && r.version !== version) load(false);
    version = r.version;
  } catch {}
}, 1000);
document.getElementById('wire').onclick = (ev) => {
  const on = ev.target.getAttribute('aria-pressed') !== 'true';
  ev.target.setAttribute('aria-pressed', String(on));
  ev.target.textContent = on ? 'Hide wireframe' : 'Show wireframe';
  scene.traverse((o) => { if (o.isMesh && o.material) o.material.wireframe = on; });
};
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => { if (mixer) mixer.update(clock.getDelta()); controls.update(); renderer.render(scene, camera); });
window.__clayform = { get mixer() { return mixer; }, scene };
</script>
</body>
</html>`;

/** What the viewer serves. `watch` mode replaces glb, bumps version, or sets error. */
export interface ViewerModel {
	glb: Uint8Array;
	version: number;
	error: string;
}

export function serveViewer(model: ViewerModel, title: string, port: number): Promise<string> {
	const page = PAGE(title.replace(/[<>&"]/g, ''));
	const server = createServer((req, res) => {
		if (req.url?.startsWith('/model.glb')) {
			res.writeHead(200, { 'content-type': 'model/gltf-binary', 'cache-control': 'no-store' });
			res.end(model.glb);
		} else if (req.url === '/version') {
			res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			res.end(JSON.stringify({ version: model.version, error: model.error }));
		} else if (req.url === '/' || req.url?.startsWith('/?')) {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
			res.end(page);
		} else {
			res.writeHead(404).end();
		}
	});
	return new Promise((ok, bad) => {
		server.once('error', bad);
		server.listen(port, '127.0.0.1', () => ok(`http://127.0.0.1:${port}/`));
	});
}

export function readGlb(path: string): Uint8Array {
	return new Uint8Array(readFileSync(path));
}
