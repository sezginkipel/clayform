/**
 * Clayform MCP server (stdio).
 *
 *   claude mcp add clayform -- npx -y clayform mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Workspace } from '../session.js';
import { VERSION } from '../version.js';
import { Tools } from './tools.js';

const scene = z.string().describe('scene id (from new_scene / list_scenes)');
const view = z.union([z.string(), z.object({ yaw: z.number(), pitch: z.number().optional() })]);

export function createServer(workspaceDir?: string): { server: McpServer; tools: Tools } {
	const ws = new Workspace(workspaceDir);
	const t = new Tools(ws);
	const server = new McpServer(
		{ name: 'clayform', version: VERSION },
		{
			instructions:
				'Clayform builds 3D models, animations and effects from a semantic scene document. Start with `guide` once, then `list_templates` → `new_scene` → `render` → `edit` (read the critics it returns) → `preview_motion` / `preview_effect` → `export`.'
		}
	);

	server.registerTool('guide', {
		title: 'Read the Clayform manual',
		description: 'How scenes, parts, anchors, sculpts, clips and effects work, plus the edit ops. Read once before building. topic "schema" returns the full JSON Schema.',
		inputSchema: { topic: z.enum(['manual', 'schema']).optional() }
	}, (a) => t.guide(a));

	server.registerTool('list_templates', {
		title: 'List starting templates',
		description: 'Hand-tuned starting points (characters, animals, vehicles, buildings, nature, props). Editing the closest template beats writing proportions from scratch.',
		inputSchema: {}
	}, () => t.listTemplates());

	server.registerTool('list_parts', {
		title: 'Find reusable parts',
		description: 'Search the part library (eyes, ears, noses, horns, tails, wings, limbs, wheels, windows, doors, hats, backpacks …). Add one with the edit op add_library_part.',
		inputSchema: { query: z.string().optional().describe('a word like eye, tail, vehicle, robot') }
	}, (a) => t.listParts(a));

	server.registerTool('new_scene', {
		title: 'Create a scene',
		description: 'Create a scene, optionally from a template. Returns its id, a part summary with world positions, and critics.',
		inputSchema: { name: z.string().min(1).max(80), template: z.string().optional().describe('template id from list_templates') }
	}, (a) => t.newScene(a));

	server.registerTool('list_scenes', { title: 'List scenes', description: 'Scenes in this workspace.', inputSchema: {} }, () => t.listScenes());

	server.registerTool('get_scene', {
		title: 'Read a scene',
		description: 'summary: parts with resolved world centers and sizes (default). json: the full document.',
		inputSchema: { scene, format: z.enum(['summary', 'json']).optional() }
	}, (a) => t.getScene(a));

	server.registerTool('edit', {
		title: 'Edit a scene (atomic batch)',
		description:
			'Apply ops in order; all or nothing. Ops: add_part{part,after?} add_library_part{name,id,attach,size?,mirror?,color?} update_part{id,set} remove_part{id,cascade?} rename_part{id,to} duplicate_part{id,as,set?} add_sculpt{sculpt} update_sculpt{id,set} remove_sculpt{id} add_clip{clip} update_clip{id,set} remove_clip{id} add_effect{effect} update_effect{id,set} remove_effect{id} set_settings{set} set_palette{set} set_meta{name?,notes?} replace{scene}. `set` merges objects, replaces arrays, null removes. Returns what changed and the critics. See guide for part/sculpt/clip/effect fields.',
		inputSchema: {
			scene,
			ops: z.array(z.record(z.string(), z.unknown())).min(1).max(200).describe('e.g. [{"op":"update_part","id":"head","set":{"shape":{"radius":0.24}}}]'),
			render: z.boolean().optional().describe('also return a three-quarter render')
		}
	}, (a) => t.edit(a));

	server.registerTool('render', {
		title: 'Look at the model',
		description: 'Render a labelled sheet. Default views: front, left, top, three_quarter. Views: front back left right top bottom three_quarter three_quarter_back or {yaw, pitch}. mode: shaded (default) · parts (one color per part + legend, to see what is what) · clay · normals · depth. Also returns the critics.',
		inputSchema: {
			scene,
			views: z.array(view).max(8).optional(),
			mode: z.enum(['shaded', 'parts', 'clay', 'normals', 'depth']).optional(),
			size: z.number().int().min(128).max(768).optional().describe('tile size in px'),
			compare: z.enum(['previous']).optional().describe('"previous": the state before the last edit (top row) and now (bottom row), same camera, plus which parts changed')
		}
	}, (a) => t.render(a));

	server.registerTool('beauty', {
		title: 'Presentation render',
		description: 'A picture to show people, not to judge shape (use render for that): a lighting preset (studio, sunset, overcast, night), soft shadows from a shadow map, a clean floor or a transparent background. turntable: {frames, seconds} writes a full turn as an animated PNG (plays in browsers, GitHub and store pages). Writes the file and returns the image.',
		inputSchema: {
			scene,
			light: z.enum(['studio', 'sunset', 'overcast', 'night']).optional(),
			background: z.union([z.enum(['preset', 'transparent']), z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)]).optional().describe('preset (the light gradient, default), transparent (model + shadow only), or a color'),
			size: z.number().int().min(128).max(1536).optional().describe('px, square (default 1024; 480 for a turntable, at most 768)'),
			yaw: z.number().optional().describe('camera around the model, degrees (default 35; 0 = front)'),
			pitch: z.number().min(-10).max(80).optional().describe('camera height, degrees (default 18)'),
			clip: z.string().optional().describe('pose from this clip (a turntable plays it while turning)'),
			time: z.number().min(0).optional().describe('seconds into the clip for a still'),
			turntable: z.object({ frames: z.number().int().min(4).max(120).optional(), seconds: z.number().min(0.5).max(30).optional() }).optional(),
			path: z.string().optional().describe('where to write the .png (default exports/<scene>-beauty.png)')
		}
	}, (a) => t.beauty(a));

	server.registerTool('compare_reference', {
		title: 'Compare with a reference image',
		description: 'Fit the model to a reference picture (concept sketch, photo, turnaround). Give a PNG with a transparent or plain background showing the whole object from one side, and the matching view (front, back, left, right, top). Returns an IoU score, an overlay (orange = only in the reference, blue = only in the model) and sentences naming the parts that are too wide or narrow. Edit, compare again, and watch the score go up.',
		inputSchema: { scene, image: z.string().describe('path to a .png'), view: z.enum(['front', 'back', 'left', 'right', 'top']).optional() }
	}, (a) => t.compareReference(a));

	server.registerTool('measure', {
		title: 'Measure exactly',
		description: 'Exact answers instead of guessing from pictures. queries: {between: [a, b]} surface distance (negative = overlap depth) and closest points · {part: id} size, center, bounds, ground contact · {ratio: [a, b], axis: x|y|z|max} size of a over b · {pixel: {view, x, y, size?}} which part is at that pixel of a render tile. Meters, grounded world.',
		inputSchema: { scene, queries: z.array(z.record(z.string(), z.unknown())).min(1).max(40) }
	}, (a) => t.measure(a));

	server.registerTool('inspect', {
		title: 'Measure the model',
		description: 'Part summary + critics (floating/split pieces, buried or vanished parts, thin detail, symmetry, tipping, triangle budget, parts that will stretch in animation) + a check of every clip.',
		inputSchema: { scene }
	}, (a) => t.inspect(a));

	server.registerTool('preview_motion', {
		title: 'See a clip as frames',
		description: 'Render a clip as a labelled film strip (default 6 frames from the left side) and report ground contact.',
		inputSchema: { scene, clip: z.string(), frames: z.number().int().min(2).max(12).optional(), view: view.optional() }
	}, (a) => t.previewMotion(a));

	server.registerTool('preview_effect', {
		title: 'See an effect',
		description: 'Bake an effect and show up to 8 frames.',
		inputSchema: { scene, effect: z.string() }
	}, (a) => t.previewEffect(a));

	server.registerTool('export', {
		title: 'Export',
		description: 'glb (default: meshes, materials, vertex colors, skin + animations when clips exist) · obj · json (the scene) · flipbook (an effect as sprite sheet PNG + JSON). Triangles are reduced within 0.4% of the shape unless `triangles` sets a budget. Default path: <workspace>/exports/.',
		inputSchema: {
			scene,
			format: z.enum(['glb', 'obj', 'json', 'flipbook']).optional(),
			path: z.string().optional(),
			triangles: z.number().int().min(100).max(2_000_000).optional(),
			effect: z.string().optional(),
			bakeAo: z.boolean().optional().describe('multiply ambient occlusion into vertex colors (default true)'),
			lods: z.array(z.number().gt(0).lt(1)).max(4).optional().describe('extra levels of detail as fractions of the triangle count, e.g. [0.5, 0.2] → <name>_LOD1, _LOD2'),
			collision: z.enum(['none', 'parts', 'hull']).optional().describe('convex collision shapes: one per part (parts, a compound collider), one for the whole model (hull)'),
			engine: z.enum(['godot', 'unreal', 'unity', 'plain']).optional().describe('name collision nodes the way that engine picks them up (godot: -convcolonly, unreal: UCX_, unity: _collider)'),
			skeleton: z
				.enum(['parts', 'humanoid', 'mixamo', 'unreal'])
				.optional()
				.describe('bone names: one per part (default), or the standard humanoid set so Unity Humanoid, Mixamo or Unreal retarget clips onto the character (needs a body, head, two arms, two legs or a robe to the ground)'),
			texture: z.number().int().min(64).max(8192).optional().describe('bake colors into a texture of this many pixels (e.g. 1024) with UVs, for engines whose default material ignores vertex colors'),
			shading: z.enum(['smooth', 'flat', 'toon']).optional().describe('smooth (default) · flat: faceted low-poly normals · toon: light baked in bands, unlit material'),
			bands: z.number().int().min(2).max(8).optional().describe('light steps for toon shading (default 3)'),
			outline: z.number().min(0).max(0.2).optional().describe('inverted-hull outline this many meters wide, e.g. 0.01 (toon look)'),
		}
	}, (a) => t.exportScene(a));

	server.registerTool('export_kit', {
		title: 'Export a kit',
		description: 'Export several scenes as separate GLBs that share one texture atlas (atlas.png next to them, or embedded in each with embed). Engines load the texture once and can batch the whole kit. Returns the atlas image.',
		inputSchema: {
			scenes: z.array(z.string()).min(1).max(64),
			dir: z.string().optional().describe('output folder (default <workspace>/exports/kit)'),
			atlas: z.number().int().min(64).max(8192).optional().describe('atlas size in pixels (default 2048)'),
			triangles: z.number().int().min(100).max(2_000_000).optional().describe('triangle budget per scene'),
			embed: z.boolean().optional(),
			shading: z.enum(['smooth', 'flat', 'toon']).optional().describe('smooth (default) · flat: faceted low-poly normals · toon: light baked in bands, unlit material'),
			bands: z.number().int().min(2).max(8).optional().describe('light steps for toon shading (default 3)'),
			outline: z.number().min(0).max(0.2).optional().describe('inverted-hull outline this many meters wide, e.g. 0.01 (toon look)'),
			collision: z.enum(['none', 'parts', 'hull']).optional(),
			engine: z.enum(['godot', 'unreal', 'unity', 'plain']).optional()
		}
	}, (a) => t.exportKit(a));

	server.registerTool('set_layout', {
		title: 'Place many objects',
		description: 'Create or replace a layout: many scenes or templates placed together (a street, a dungeon corner, a forest patch). layout = { format: "clayform-layout/1", name, items: [{ id, scene, position: [x, z] or [x, y, z], rotation (yaw deg), scale }], patterns: [{ id, scene, type: row|grid|circle|scatter, count, spacing, columns, radius, area: [w, d], origin: [x, z], direction, rotate: none|random|face_center|face_out|deg, scaleJitter, minGap, seed }] }. scene is a workspace scene id, a template id or a .clay.json path.',
		inputSchema: { name: z.string().min(1).max(80), layout: z.record(z.string(), z.unknown()) }
	}, (a) => t.setLayout(a));

	server.registerTool('render_layout', {
		title: 'Look at a layout',
		description: 'Render a layout (default views: top and three_quarter) and check it: items that pass through each other, items lifted off the ground.',
		inputSchema: { layout: z.string(), views: z.array(view).max(6).optional(), size: z.number().int().min(128).max(768).optional(), mode: z.enum(['shaded', 'parts', 'clay']).optional() }
	}, (a) => t.renderLayout(a));

	server.registerTool('export_layout', {
		title: 'Export a layout',
		description: 'Write the whole layout as one GLB, one node per item. triangles is a budget per distinct scene.',
		inputSchema: { layout: z.string(), path: z.string().optional(), triangles: z.number().int().min(100).max(2_000_000).optional() }
	}, (a) => t.exportLayout(a));

	server.registerTool('history', {
		title: 'Undo, redo, snapshots',
		description: 'undo · redo · snapshot{label} · restore{label} · list. Every edit is one undo step.',
		inputSchema: { scene, action: z.enum(['undo', 'redo', 'snapshot', 'restore', 'list']), label: z.string().max(60).optional() }
	}, (a) => t.history(a));

	server.registerTool('import_scene', {
		title: 'Import a scene',
		description: 'Load a .clay.json file (path) or a scene document (json) into the workspace.',
		inputSchema: { path: z.string().optional(), json: z.unknown().optional(), name: z.string().optional() }
	}, (a) => t.importScene(a));

	return { server, tools: t };
}

export async function serveStdio(workspaceDir?: string) {
	const { server } = createServer(workspaceDir);
	await server.connect(new StdioServerTransport());
}
