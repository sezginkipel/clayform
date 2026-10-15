/**
 * Automated unattended evaluation harness for Clayform scenes and benchmark runs.
 * Validates syntax, SDF meshing, critics, triangle budgets, animation tracks,
 * motion collision critics, effects flipbooks, and engine compatibility.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRig, critiqueClip, sampleClip } from './anim/rig.js';
import { buildScene, type Build } from './core/build.js';
import { parseScene, type Scene } from './core/schema.js';
import { simplifyBuild } from './core/simplify.js';
import { critique, type Report } from './critic/critics.js';
import { exportGlb } from './export/gltf.js';
import { validateEngineGlb, type EngineValidation } from './export/validate-engine.js';
import { TEMPLATES } from './templates/index.js';

export interface EvalExpectation {
	clips?: string[];
	effects?: boolean;
	budgetTriangles?: number;
	engine?: 'godot' | 'unity' | 'unreal' | 'all';
}

export interface EvalResult {
	id: string;
	ok: boolean;
	parsed: boolean;
	triangles: number;
	simplifiedTriangles: number;
	buildMs: number;
	critics: {
		ok: boolean;
		errors: number;
		warnings: number;
		issues: string[];
	};
	clips: {
		ok: boolean;
		present: string[];
		missing: string[];
		motionOk: boolean;
		motionIssues: string[];
	};
	effects: {
		ok: boolean;
		count: number;
	};
	engine: {
		ok: boolean;
		issues: string[];
	};
	error?: string;
}

export interface EvalSummary {
	total: number;
	passed: number;
	failed: number;
	passRate: number;
	cleanCritics: number;
	averageBuildMs: number;
	results: EvalResult[];
}

export async function evaluateScene(
	id: string,
	scene: Scene,
	expects: EvalExpectation = {}
): Promise<EvalResult> {
	const start = Date.now();
	let b: Build;
	try {
		b = buildScene(scene);
	} catch (e) {
		return {
			id,
			ok: false,
			parsed: true,
			triangles: 0,
			simplifiedTriangles: 0,
			buildMs: Date.now() - start,
			critics: { ok: false, errors: 1, warnings: 0, issues: [(e as Error).message] },
			clips: { ok: false, present: [], missing: [], motionOk: false, motionIssues: [] },
			effects: { ok: false, count: 0 },
			engine: { ok: false, issues: [] },
			error: `Build failed: ${(e as Error).message}`
		};
	}

	const buildMs = Date.now() - start;
	const rep: Report = critique(b);
	const errors = rep.issues.filter((i) => i.severity === 'error');
	const warnings = rep.issues.filter((i) => i.severity === 'warn');

	// Simplification & Triangle Budget
	const targetBudget = expects.budgetTriangles ?? scene.settings?.budget ?? 5000;
	const simplified = await simplifyBuild(b, { triangles: targetBudget });
	const simplifiedTriangles = simplified.stats.triangles;
	const budgetOk = targetBudget ? simplifiedTriangles <= targetBudget * 1.05 : true;

	// Clips & Motion check
	const clipTypes = new Set((scene.clips ?? []).map((c) => c.type));
	const requiredClips = expects.clips ?? [];
	const missingClips = requiredClips.filter((req) => !clipTypes.has(req as never));
	let motionOk = true;
	const motionIssues: string[] = [];

	if (scene.clips?.length) {
		const rig = buildRig(b);
		for (const c of scene.clips) {
			const clipCrit = critiqueClip(b, rig, sampleClip(b, rig, c), scene.settings?.ground !== 'none');
			if (clipCrit.issues.length) {
				motionOk = false;
				motionIssues.push(`${c.id}: ${clipCrit.issues.join(', ')}`);
			}
		}
	}

	// Effects
	const effectCount = scene.effects?.length ?? 0;
	const effectsOk = expects.effects ? effectCount > 0 : true;

	// Engine Export Validation
	const { glb } = exportGlb(simplified, {
		collision: 'parts',
		naming: expects.engine === 'all' || !expects.engine ? 'plain' : (expects.engine as any)
	});
	const engVal: EngineValidation = validateEngineGlb(glb, expects.engine ?? 'all');
	const engineIssues = engVal.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.message}`);

	const ok = errors.length === 0 && budgetOk && missingClips.length === 0 && motionOk && effectsOk && engVal.ok;

	return {
		id,
		ok,
		parsed: true,
		triangles: b.stats.triangles,
		simplifiedTriangles,
		buildMs,
		critics: {
			ok: errors.length === 0,
			errors: errors.length,
			warnings: warnings.length,
			issues: rep.issues.filter((i) => i.severity !== 'info').map((i) => `[${i.code}] ${i.message}`)
		},
		clips: {
			ok: missingClips.length === 0 && motionOk,
			present: [...clipTypes],
			missing: missingClips,
			motionOk,
			motionIssues
		},
		effects: {
			ok: effectsOk,
			count: effectCount
		},
		engine: {
			ok: engVal.ok,
			issues: engineIssues
		}
	};
}

export async function evaluateBenchmarkFolder(
	dir: string,
	benchPromptsPath = 'bench/prompts.json',
	engine: 'godot' | 'unity' | 'unreal' | 'all' = 'all'
): Promise<EvalSummary> {
	let prompts: { id: string; category: string; expects: { clips?: string[]; effects?: boolean } }[] = [];
	let budget = 5000;

	if (existsSync(benchPromptsPath)) {
		try {
			const b = JSON.parse(readFileSync(benchPromptsPath, 'utf8'));
			prompts = b.prompts ?? [];
			if (b.budget?.triangles) budget = b.budget.triangles;
		} catch {}
	}

	const results: EvalResult[] = [];
	let totalBuildMs = 0;

	for (const p of prompts) {
		const filePath = join(dir, `${p.id}.clay.json`);
		if (!existsSync(filePath)) {
			results.push({
				id: p.id,
				ok: false,
				parsed: false,
				triangles: 0,
				simplifiedTriangles: 0,
				buildMs: 0,
				critics: { ok: false, errors: 1, warnings: 0, issues: ['File missing'] },
				clips: { ok: false, present: [], missing: p.expects.clips ?? [], motionOk: false, motionIssues: [] },
				effects: { ok: false, count: 0 },
				engine: { ok: false, issues: [] },
				error: 'Missing output file'
			});
			continue;
		}

		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(filePath, 'utf8'));
		} catch (e) {
			results.push({
				id: p.id,
				ok: false,
				parsed: false,
				triangles: 0,
				simplifiedTriangles: 0,
				buildMs: 0,
				critics: { ok: false, errors: 1, warnings: 0, issues: ['JSON syntax error'] },
				clips: { ok: false, present: [], missing: [], motionOk: false, motionIssues: [] },
				effects: { ok: false, count: 0 },
				engine: { ok: false, issues: [] },
				error: (e as Error).message
			});
			continue;
		}

		const parsed = parseScene(raw);
		if (!parsed.ok) {
			results.push({
				id: p.id,
				ok: false,
				parsed: false,
				triangles: 0,
				simplifiedTriangles: 0,
				buildMs: 0,
				critics: { ok: false, errors: 1, warnings: 0, issues: [parsed.error] },
				clips: { ok: false, present: [], missing: [], motionOk: false, motionIssues: [] },
				effects: { ok: false, count: 0 },
				engine: { ok: false, issues: [] },
				error: parsed.error
			});
			continue;
		}

		const res = await evaluateScene(p.id, parsed.scene, {
			clips: p.expects.clips,
			effects: p.expects.effects,
			budgetTriangles: budget,
			engine
		});
		totalBuildMs += res.buildMs;
		results.push(res);
	}

	const passed = results.filter((r) => r.ok).length;
	const cleanCritics = results.filter((r) => r.critics.ok && r.critics.warnings === 0).length;

	return {
		total: results.length,
		passed,
		failed: results.length - passed,
		passRate: results.length ? +(passed / results.length).toFixed(3) : 0,
		cleanCritics,
		averageBuildMs: results.length ? Math.round(totalBuildMs / results.length) : 0,
		results
	};
}

export async function evaluateTemplates(
	engine: 'godot' | 'unity' | 'unreal' | 'all' = 'all',
	filterIds?: string[]
): Promise<EvalSummary> {
	const templates = filterIds ? TEMPLATES.filter((t) => filterIds.includes(t.id)) : TEMPLATES;
	const results: EvalResult[] = [];
	let totalBuildMs = 0;

	for (const t of templates) {
		const res = await evaluateScene(t.id, t.scene, { engine });
		totalBuildMs += res.buildMs;
		results.push(res);
	}

	const passed = results.filter((r) => r.ok).length;
	const cleanCritics = results.filter((r) => r.critics.ok && r.critics.warnings === 0).length;

	return {
		total: results.length,
		passed,
		failed: results.length - passed,
		passRate: results.length ? +(passed / results.length).toFixed(3) : 0,
		cleanCritics,
		averageBuildMs: results.length ? Math.round(totalBuildMs / results.length) : 0,
		results
	};
}

export function formatEvalReport(summary: EvalSummary): string {
	const lines = [
		`# Clayform Evaluation Report`,
		``,
		`**Pass Rate:** ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(1)}%) · **Clean Critics:** ${summary.cleanCritics}/${summary.total} · **Avg Build:** ${summary.averageBuildMs} ms`,
		``,
		`| ID | Status | Critics | Tris (Export) | Clips | Effects | Engine | Build (ms) | Notes |`,
		`|---|---|---|---|---|---|---|---|---|`
	];

	for (const r of summary.results) {
		const status = r.ok ? '✅ PASS' : '❌ FAIL';
		const crit = r.critics.ok ? (r.critics.warnings ? `⚠️ ${r.critics.warnings} warn` : '✓ clean') : `✗ ${r.critics.errors} err`;
		const clips = r.clips.ok ? '✓' : r.clips.missing.length ? `missing: ${r.clips.missing.join(',')}` : 'motion issue';
		const fx = r.effects.ok ? '✓' : 'missing';
		const eng = r.engine.ok ? '✓' : 'issue';
		const notes = [...r.critics.issues, ...r.clips.motionIssues, ...r.engine.issues].slice(0, 2).join('; ');
		lines.push(`| ${r.id} | ${status} | ${crit} | ${r.simplifiedTriangles} | ${clips} | ${fx} | ${eng} | ${r.buildMs} | ${notes || '–'} |`);
	}

	return lines.join('\n') + '\n';
}
