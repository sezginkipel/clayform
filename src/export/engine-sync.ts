/**
 * Live Game Engine Sync Bridge (`sync_engine` / `clayform sync`).
 * Exports a Clayform scene directly into a Godot 4, Unity, or Unreal Engine 5 project
 * directory with engine-specific collision hulls, bone naming, LODs, and import sidecars.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkeletonNaming } from '../anim/humanoid.js';
import type { Build } from '../core/build.js';
import { userPath } from '../core/files.js';
import { simplifyBuild } from '../core/simplify.js';
import { exportGlb } from './gltf.js';
import type { Shading } from './texture.js';
import { validateEngineGlb, type EngineValidation } from './validate-engine.js';

export type TargetEngine = 'godot' | 'unity' | 'unreal';

export interface EngineSyncOptions {
	projectDir: string;
	assetName: string;
	engine: TargetEngine;
	subdir?: string;
	skeleton?: SkeletonNaming;
	collision?: 'none' | 'parts' | 'hull';
	lods?: number[];
	triangles?: number;
	texture?: number;
	shading?: Shading;
}

export interface EngineSyncResult {
	engine: TargetEngine;
	glbPath: string;
	sidecarPath?: string;
	bytes: number;
	triangles: number;
	validation: EngineValidation;
}

const DEFAULT_SUBDIRS: Record<TargetEngine, string> = {
	godot: 'assets/models',
	unity: 'Assets/Models',
	unreal: 'Content/Models'
};

function godotImportSidecar(assetName: string): string {
	return `[remap]

importer="scene"
importer_version=1
type="PackedScene"
path="res://.godot/imported/${assetName}.glb"

[deps]

source_file="res://assets/models/${assetName}.glb"

[params]

nodes/root_type=""
nodes/root_name="${assetName}"
meshes/ensure_tangents=true
meshes/generate_lods=true
meshes/create_shadow_meshes=true
meshes/light_baking=1
skins/use_named_skins=true
animation/import=true
animation/fps=30
`;
}

export async function syncToEngineProject(fullBuild: Build, opts: EngineSyncOptions): Promise<EngineSyncResult> {
	const safeName = opts.assetName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'model';
	const rootDir = userPath(opts.projectDir);
	const relSubdir = opts.subdir !== undefined ? opts.subdir : DEFAULT_SUBDIRS[opts.engine];
	const targetDir = resolve(rootDir, relSubdir);
	mkdirSync(targetDir, { recursive: true });

	const b = await simplifyBuild(fullBuild, opts.triangles ? { triangles: opts.triangles } : {});
	const lodBuilds: Build[] = [];
	for (const factor of opts.lods ?? [0.5, 0.25]) {
		lodBuilds.push(await simplifyBuild(fullBuild, { triangles: Math.max(100, Math.round(b.stats.triangles * factor)) }));
	}

	const defaultSkeleton: SkeletonNaming | undefined =
		opts.skeleton ?? (opts.engine === 'unreal' ? undefined : undefined);

	const exported = exportGlb(b, {
		lods: lodBuilds,
		collision: opts.collision ?? 'parts',
		naming: opts.engine,
		skeleton: defaultSkeleton,
		texture: opts.texture,
		shading: opts.shading
	});

	const validation = validateEngineGlb(exported.glb, opts.engine);
	const glbPath = join(targetDir, `${safeName}.glb`);
	writeFileSync(glbPath, exported.glb);

	let sidecarPath: string | undefined;
	if (opts.engine === 'godot') {
		const importFile = `${glbPath}.import`;
		if (!existsSync(importFile)) {
			writeFileSync(importFile, godotImportSidecar(safeName));
		}
		sidecarPath = importFile;
	} else {
		const metaFile = join(targetDir, `${safeName}.clayform.json`);
		writeFileSync(
			metaFile,
			JSON.stringify(
				{
					generator: 'clayform',
					engine: opts.engine,
					asset: `${safeName}.glb`,
					triangles: exported.stats.triangles,
					joints: exported.stats.joints,
					animations: validation.summary.animations,
					sockets: validation.summary.sockets,
					colliders: validation.summary.colliders,
					lods: validation.summary.lods,
					morphTargets: validation.summary.morphTargets
				},
				null,
				2
			)
		);
		sidecarPath = metaFile;
	}

	return {
		engine: opts.engine,
		glbPath,
		sidecarPath,
		bytes: exported.stats.bytes,
		triangles: exported.stats.triangles,
		validation
	};
}
