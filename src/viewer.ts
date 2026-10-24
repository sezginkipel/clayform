/**
 * `clayform view <scene|template|file.glb>` — Interactive 3D test & diagnostic playground.
 * Visualizes glTF geometry, wireframes, skeletal bones, equipment sockets, collision hulls,
 * morph targets/expressions, and animation playback with speed control and critics feedback.
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
  :root {
    --bg: #18191c;
    --card: #222429;
    --ink: #e8e9ec;
    --muted: #9598a0;
    --line: #32353d;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --badge-ok: #10b981;
    --badge-warn: #f59e0b;
    --badge-err: #ef4444;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
  #app { position: fixed; inset: 0; }
  
  /* Top toolbar */
  header {
    position: fixed; top: 12px; left: 12px; right: 12px;
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    pointer-events: none; z-index: 10;
  }
  header > * { pointer-events: auto; }
  h1 { font-size: 14px; font-weight: 600; margin: 0 10px 0 0; color: #fff; display: flex; align-items: center; gap: 6px; }
  h1 span.badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-weight: 500; }
  
  .btn-group { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--card); }
  .btn-group button { border: none; border-right: 1px solid var(--line); border-radius: 0; }
  .btn-group button:last-child { border-right: none; }

  button {
    font: inherit; font-size: 12px; border: 1px solid var(--line);
    background: var(--card); color: var(--ink); border-radius: 6px;
    padding: 6px 11px; cursor: pointer; transition: all 0.15s ease;
  }
  button:hover { background: #2c2f37; border-color: #454955; }
  button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  
  #stats {
    color: var(--muted); margin-left: auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11px; background: rgba(34, 36, 41, 0.85); padding: 5px 10px; border-radius: 6px; border: 1px solid var(--line);
  }

  /* Morph & Diagnostics Drawer */
  #drawer {
    position: fixed; top: 58px; right: 12px; width: 280px; max-height: calc(100vh - 80px);
    background: rgba(34, 36, 41, 0.92); backdrop-filter: blur(8px); border: 1px solid var(--line);
    border-radius: 8px; padding: 12px; z-index: 9; overflow-y: auto; display: none;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  #drawer h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 10px 0; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  .morph-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .morph-row label { font-size: 12px; color: var(--ink); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .morph-row input[type="range"] { width: 120px; accent-color: var(--accent); }
  
  /* Diagnostics list */
  #critics-box { margin-top: 14px; }
  .crit-item { font-size: 11px; padding: 4px 6px; border-radius: 4px; margin-bottom: 4px; }
  .crit-err { background: rgba(239, 68, 68, 0.15); color: #f87171; border-left: 3px solid var(--badge-err); }
  .crit-warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-left: 3px solid var(--badge-warn); }
  .crit-clean { background: rgba(16, 185, 129, 0.15); color: #34d399; border-left: 3px solid var(--badge-ok); }

  #error {
    position: fixed; bottom: 16px; left: 16px; right: 16px; color: #fca5a5;
    background: rgba(239, 68, 68, 0.18); border: 1px solid #ef4444; border-radius: 6px;
    padding: 8px 12px; z-index: 20; display: none; font-size: 12px;
  }
</style>
</head>
<body>
<div id="app"></div>
<header>
  <h1>${title} <span class="badge">Test Harness</span></h1>
  
  <div class="btn-group" id="clips"></div>
  
  <div class="btn-group">
    <button id="pause" title="Play / Pause">⏸ Pause</button>
    <button id="speed" title="Cycle playback speed">1.0x</button>
  </div>

  <div class="btn-group">
    <button id="wire" title="Toggle mesh wireframe">Wire</button>
    <button id="bones" title="Show joints and skeleton">Bones</button>
    <button id="sockets" title="Visualize equipment sockets">Sockets</button>
    <button id="colliders" title="Show collision bounds">Colliders</button>
  </div>

  <button id="drawer-toggle" title="Toggle morph targets and diagnostics">Controls ▾</button>

  <span id="stats">loading...</span>
</header>

<div id="drawer">
  <div id="morphs-section" style="display: none;">
    <h2>Expressions (Morph Targets)</h2>
    <div id="morph-sliders"></div>
  </div>
  
  <div id="critics-box">
    <h2>Diagnostics & Engine Status</h2>
    <div id="critics-list"></div>
  </div>
</div>

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
scene.background = new THREE.Color(0x18191c);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(20, 80, 0x32353d, 0x222429);
scene.add(grid);

const clock = new THREE.Clock();
let mixer = null;
let current = null, root = null, version = null;
let skeletonHelper = null;
const socketHelpers = [];
let timeScale = 1.0;
let isPaused = false;
let morphMeshes = [];

function load(first) {
  new GLTFLoader().load('/model.glb?v=' + Date.now(), (gltf) => {
    if (root) {
      root.traverse((o) => {
        if (o.isMesh) {
          if (o.geometry) o.geometry.dispose();
          if (o.userData.__origMat) o.userData.__origMat.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else if (o.material) o.material.dispose();
        }
      });
      scene.remove(root);
      if (mixer) mixer.stopAllAction();
      if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper = null; }
      clearSockets();
    }
    root = gltf.scene;
    
    let tris = 0, meshes = 0, joints = 0;
    const socketNames = [];
    morphMeshes = [];

    root.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        o.castShadow = true;
        o.receiveShadow = true;
        tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        if (o.morphTargetDictionary) morphMeshes.push(o);
      }
      if (o.isBone) joints++;
      if (o.name && o.name.startsWith('SOCKET_')) socketNames.push(o.name);
    });

    scene.add(root);

    if (first) {
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z, 0.2);
      camera.position.set(c.x + r * 1.4, c.y + r * 0.9, c.z + r * 1.9);
      controls.target.copy(c);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -r * 2;
      sun.shadow.camera.right = sun.shadow.camera.top = r * 2;
    }

    // Update stats bar
    const statsText = Math.round(tris).toLocaleString() + ' tris · ' +
      joints + ' joints · ' + socketNames.length + ' sockets · ' +
      gltf.animations.length + ' clips' +
      (first ? '' : ' · ' + new Date().toLocaleTimeString());
    document.getElementById('stats').textContent = statsText;
    hideError();

    // Setup animation clips
    const bar = document.getElementById('clips');
    const playing = current ? current.name : null;
    bar.replaceChildren();
    current = null;
    mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    if (mixer) mixer.timeScale = isPaused ? 0 : timeScale;

    gltf.animations.forEach((clip, i) => {
      const b = document.createElement('button');
      b.textContent = clip.name;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => {
        if (current) { current.action.stop(); current.button.setAttribute('aria-pressed', 'false'); }
        const action = mixer.clipAction(clip); action.play();
        current = { action, button: b, name: clip.name }; b.setAttribute('aria-pressed', 'true');
      };
      bar.appendChild(b);
      if (playing ? clip.name === playing : i === 0) b.click();
    });

    // Setup morph targets
    setupMorphs();

    // Restore active toggles
    if (document.getElementById('bones').getAttribute('aria-pressed') === 'true') toggleBones(true);
    if (document.getElementById('sockets').getAttribute('aria-pressed') === 'true') toggleSockets(true);
    if (document.getElementById('wire').getAttribute('aria-pressed') === 'true') applyWireframe(true);
    if (document.getElementById('colliders').getAttribute('aria-pressed') === 'true') toggleColliders(true);
  }, undefined, (e) => {
    showError('Could not load the model: ' + (e.message || e) + '. Check the terminal running clayform view.');
  });
}

function clearSockets() {
  socketHelpers.forEach((h) => scene.remove(h));
  socketHelpers.length = 0;
}

function toggleBones(on) {
  if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper = null; }
  if (on && root) {
    skeletonHelper = new THREE.SkeletonHelper(root);
    skeletonHelper.material.color = new THREE.Color(0x38bdf8);
    skeletonHelper.material.depthTest = false;
    skeletonHelper.renderOrder = 998;
    scene.add(skeletonHelper);
  }
}

function toggleSockets(on) {
  clearSockets();
  if (!on || !root) return;
  root.traverse((node) => {
    if (node.name && node.name.startsWith('SOCKET_')) {
      const axes = new THREE.AxesHelper(0.12);
      axes.material.depthTest = false;
      axes.renderOrder = 999;
      node.add(axes);
      socketHelpers.push(axes);

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xec4899, depthTest: false })
      );
      sphere.renderOrder = 1000;
      node.add(sphere);
      socketHelpers.push(sphere);
    }
  });
}

function applyWireframe(on) {
  if (!root) return;
  root.traverse((o) => {
    if (o.isMesh && o.material) o.material.wireframe = on;
  });
}

function toggleColliders(on) {
  if (!root) return;
  root.traverse((node) => {
    const isCol = node.name && (node.name.includes('col') || node.name.startsWith('UCX_') || node.name.includes('collider'));
    if (isCol && node.isMesh) {
      node.visible = on;
      if (on && !node.userData.__origMat) {
        node.userData.__origMat = node.material;
        node.material = new THREE.MeshBasicMaterial({ color: 0x06b6d4, wireframe: true });
      } else if (!on && node.userData.__origMat) {
        node.material = node.userData.__origMat;
      }
    }
  });
}

function setupMorphs() {
  const panel = document.getElementById('morph-sliders');
  panel.replaceChildren();
  const morphSection = document.getElementById('morphs-section');
  if (!morphMeshes.length) {
    morphSection.style.display = 'none';
    return;
  }
  morphSection.style.display = 'block';
  document.getElementById('drawer').style.display = 'block';
  document.getElementById('drawer-toggle').setAttribute('aria-pressed', 'true');

  const dict = morphMeshes[0].morphTargetDictionary;
  for (const [name, index] of Object.entries(dict)) {
    const row = document.createElement('div');
    row.className = 'morph-row';
    const label = document.createElement('label');
    label.textContent = name;
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.01'; slider.value = '0';
    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      for (const m of morphMeshes) {
        if (m.morphTargetInfluences && m.morphTargetDictionary[name] !== undefined) {
          m.morphTargetInfluences[m.morphTargetDictionary[name]] = val;
        }
      }
    };
    row.appendChild(label);
    row.appendChild(slider);
    panel.appendChild(row);
  }
}

function updateDiagnostics(diag) {
  const list = document.getElementById('critics-list');
  list.replaceChildren();
  if (!diag) {
    const item = document.createElement('div');
    item.className = 'crit-item crit-clean';
    item.textContent = '✓ Ready for export';
    list.appendChild(item);
    return;
  }
  if (diag.ok && (!diag.issues || !diag.issues.length)) {
    const item = document.createElement('div');
    item.className = 'crit-item crit-clean';
    item.textContent = '✓ Critics: No defects detected';
    list.appendChild(item);
  } else if (diag.issues) {
    diag.issues.forEach((iss) => {
      const item = document.createElement('div');
      item.className = 'crit-item ' + (iss.startsWith('ERROR') ? 'crit-err' : 'crit-warn');
      item.textContent = iss;
      list.appendChild(item);
    });
  }
}

function showError(msg) {
  const p = document.getElementById('error');
  p.textContent = msg;
  p.style.display = 'block';
}

function hideError() {
  document.getElementById('error').style.display = 'none';
}

// Button click handlers
document.getElementById('wire').onclick = (ev) => {
  const on = ev.target.getAttribute('aria-pressed') !== 'true';
  ev.target.setAttribute('aria-pressed', String(on));
  applyWireframe(on);
};

document.getElementById('bones').onclick = (ev) => {
  const on = ev.target.getAttribute('aria-pressed') !== 'true';
  ev.target.setAttribute('aria-pressed', String(on));
  toggleBones(on);
};

document.getElementById('sockets').onclick = (ev) => {
  const on = ev.target.getAttribute('aria-pressed') !== 'true';
  ev.target.setAttribute('aria-pressed', String(on));
  toggleSockets(on);
};

document.getElementById('colliders').onclick = (ev) => {
  const on = ev.target.getAttribute('aria-pressed') !== 'true';
  ev.target.setAttribute('aria-pressed', String(on));
  toggleColliders(on);
};

document.getElementById('pause').onclick = (ev) => {
  isPaused = !isPaused;
  ev.target.textContent = isPaused ? '▶ Play' : '⏸ Pause';
  if (mixer) mixer.timeScale = isPaused ? 0 : timeScale;
};

const speeds = [1.0, 0.5, 0.25, 2.0];
let speedIdx = 0;
document.getElementById('speed').onclick = (ev) => {
  speedIdx = (speedIdx + 1) % speeds.length;
  timeScale = speeds[speedIdx];
  ev.target.textContent = timeScale + 'x';
  if (mixer && !isPaused) mixer.timeScale = timeScale;
};

document.getElementById('drawer-toggle').onclick = (ev) => {
  const drawer = document.getElementById('drawer');
  const open = drawer.style.display === 'block';
  drawer.style.display = open ? 'none' : 'block';
  ev.target.setAttribute('aria-pressed', String(!open));
};

load(true);

// Live reload & diagnostics polling
setInterval(async () => {
  try {
    const r = await (await fetch('/version', { cache: 'no-store' })).json();
    if (r.error) showError('Scene error (showing last good version): ' + r.error);
    else hideError();
    if (r.diagnostics) updateDiagnostics(r.diagnostics);
    if (version !== null && r.version !== version) load(false);
    version = r.version;
  } catch {}
}, 1000);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  if (mixer) mixer.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});

window.__clayform = { get mixer() { return mixer; }, scene };
</script>
</body>
</html>`;

/** What the viewer serves. `watch` mode replaces glb, bumps version, or sets error. */
export interface ViewerModel {
	glb: Uint8Array;
	version: number;
	error: string;
	diagnostics?: {
		ok: boolean;
		triangles: number;
		issues: string[];
		sockets: string[];
	};
}

export function serveViewer(model: ViewerModel, title: string, port: number): Promise<string> {
	const page = PAGE(title.replace(/[<>&"]/g, ''));
	const baseHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
	const server = createServer((req, res) => {
		if (req.url?.startsWith('/model.glb')) {
			res.writeHead(200, { ...baseHeaders, 'content-type': 'model/gltf-binary' });
			res.end(model.glb);
		} else if (req.url === '/version') {
			res.writeHead(200, { ...baseHeaders, 'content-type': 'application/json' });
			res.end(JSON.stringify({ version: model.version, error: model.error, diagnostics: model.diagnostics }));
		} else if (req.url === '/' || req.url?.startsWith('/?')) {
			res.writeHead(200, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' });
			res.end(page);
		} else {
			res.writeHead(404, baseHeaders).end();
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
