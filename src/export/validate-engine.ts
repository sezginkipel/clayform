/**
 * Validates glTF exports for direct compatibility with Godot, Unity, and Unreal Engine.
 * Checks bone naming, node hierarchies, sockets, collision shapes, animations, and morph targets.
 */

export interface EngineValidation {
	ok: boolean;
	engine: 'godot' | 'unity' | 'unreal' | 'all';
	summary: {
		format: string;
		generator: string;
		meshes: number;
		materials: number;
		joints: number;
		animations: string[];
		morphTargets: string[];
		sockets: string[];
		colliders: string[];
		lods: string[];
	};
	checks: {
		name: string;
		passed: boolean;
		message: string;
	}[];
}

export function parseGlbJson(bytes: Uint8Array): Record<string, any> {
	if (bytes.length < 20) throw new Error('File too small to be a valid glTF binary (.glb)');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = view.getUint32(0, true);
	if (magic !== 0x46546c67) throw new Error('Not a glTF binary file (magic does not match)');
	const version = view.getUint32(4, true);
	if (version !== 2) throw new Error(`Unsupported glTF version: ${version} (expected 2)`);

	const jsonLen = view.getUint32(12, true);
	const jsonType = view.getUint32(16, true);
	if (jsonType !== 0x4e4f534a) throw new Error('First glTF chunk is not JSON');

	const jsonBytes = bytes.subarray(20, 20 + jsonLen);
	const text = new TextDecoder().decode(jsonBytes);
	return JSON.parse(text);
}

export function validateEngineGlb(bytes: Uint8Array, targetEngine: 'godot' | 'unity' | 'unreal' | 'all' = 'all'): EngineValidation {
	const json = parseGlbJson(bytes);
	const nodes: any[] = json.nodes ?? [];
	const meshes: any[] = json.meshes ?? [];
	const materials: any[] = json.materials ?? [];
	const skins: any[] = json.skins ?? [];
	const animations: any[] = json.animations ?? [];

	const nodeNames = nodes.map((n) => n.name ?? '');
	const sockets = nodeNames.filter((n) => n.startsWith('SOCKET_'));
	const colliders = nodeNames.filter((n) => n.includes('col') || n.startsWith('UCX_') || n.includes('collider'));
	const lods = nodeNames.filter((n) => /_LOD\d+$/i.test(n));

	const morphTargets = new Set<string>();
	for (const m of meshes) {
		if (m.extras?.targetNames && Array.isArray(m.extras.targetNames)) {
			for (const tn of m.extras.targetNames) morphTargets.add(tn);
		}
	}

	const animNames = animations.map((a) => a.name ?? 'unnamed');
	const jointCount = skins[0]?.joints?.length ?? 0;

	const checks: { name: string; passed: boolean; message: string }[] = [];

	// 1. glTF 2.0 Base Spec
	checks.push({
		name: 'glTF 2.0 Spec',
		passed: json.asset?.version === '2.0',
		message: `asset version is ${json.asset?.version}`
	});

	// 2. Node & Path Integrity
	const invalidChars = nodeNames.filter((n) => /[\/\\:\*\?"<>\|]/.test(n));
	checks.push({
		name: 'Node Name Sanitization',
		passed: invalidChars.length === 0,
		message: invalidChars.length === 0 ? 'all node names sanitized' : `illegal characters in: ${invalidChars.join(', ')}`
	});

	// 3. Sockets (Attachment points)
	checks.push({
		name: 'Equipment Sockets',
		passed: true,
		message: sockets.length ? `found ${sockets.length} socket(s): ${sockets.join(', ')}` : 'no SOCKET_* nodes (optional for static props)'
	});

	// 4. Animation Tracks
	if (animations.length) {
		let brokenChannels = 0;
		for (const anim of animations) {
			for (const ch of anim.channels ?? []) {
				const targetNode = ch.target?.node;
				if (targetNode === undefined || !nodes[targetNode]) brokenChannels++;
			}
		}
		checks.push({
			name: 'Animation Track Binding',
			passed: brokenChannels === 0,
			message: brokenChannels === 0 ? `${animations.length} animation clip(s) cleanly bound: ${animNames.join(', ')}` : `${brokenChannels} unbound animation tracks`
		});
	}

	// 5. Engine-specific checks
	if (targetEngine === 'godot') {
		const godotCol = colliders.filter((c) => c.endsWith('-convcolonly') || c.endsWith('-col'));
		checks.push({
			name: 'Godot: Collision Nodes',
			passed: colliders.length === 0 || godotCol.length > 0,
			message: godotCol.length ? `Godot collision shapes present: ${godotCol.join(', ')}` : colliders.length ? 'Colliders present but not in Godot format (-convcolonly)' : 'No colliders'
		});
	}

	if (targetEngine === 'unity') {
		if (skins.length) {
			const humanoidRequired = ['Hips', 'Spine', 'Head'];
			const missing = humanoidRequired.filter((req) => !nodeNames.some((n) => n.toLowerCase().includes(req.toLowerCase())));
			checks.push({
				name: 'Unity: Humanoid Bone Match',
				passed: missing.length === 0,
				message: missing.length === 0 ? 'Primary humanoid bones (Hips, Spine, Head) found' : `Missing standard bone names: ${missing.join(', ')} (export with --skeleton humanoid)`
			});
		}
	}

	if (targetEngine === 'unreal') {
		const unrealCol = colliders.filter((c) => c.startsWith('UCX_'));
		checks.push({
			name: 'Unreal: Collision Hulls',
			passed: colliders.length === 0 || unrealCol.length > 0,
			message: unrealCol.length ? `Unreal UCX_ collision hulls found: ${unrealCol.join(', ')}` : colliders.length ? 'Colliders present but not in Unreal format (UCX_*)' : 'No colliders'
		});
	}

	const ok = checks.every((c) => c.passed);

	return {
		ok,
		engine: targetEngine,
		summary: {
			format: 'glTF 2.0 (Binary)',
			generator: json.asset?.generator ?? 'Clayform',
			meshes: meshes.length,
			materials: materials.length,
			joints: jointCount,
			animations: animNames,
			morphTargets: [...morphTargets],
			sockets,
			colliders,
			lods
		},
		checks
	};
}
