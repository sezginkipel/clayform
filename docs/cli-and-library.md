# CLI and library

## CLI

Wherever a command takes a scene, you can also give a template id.

| command | does |
|---|---|
| `clayform mcp [--workspace dir]` | start the MCP server on stdio |
| `clayform templates` | list templates |
| `clayform new <template> [-o file]` | write a template as a `.clay.json` |
| `clayform render <scene> [-o png] [--views front,left] [--mode parts] [--size 384]` | render a sheet (prints the legend and critics) |
| `clayform inspect <scene>` | part summary, critics and clip checks. Exit code 2 on errors, so it can gate CI |
| `clayform export <scene> [-o out.glb\|out.obj] [--triangles N]` | export |
| `clayform motion <scene> [clip] [-o png] [--view left] [--frames 6]` | film strip |
| `clayform effect <scene> [effect] [-o png]` | flipbook + `.json` + `.preview.png` |
| `clayform view <scene\|template\|file.glb> [--port 5231] [--watch]` | local three.js viewer that plays clips. `--watch` reloads when the scene file changes, and when an edit is invalid it keeps the last good version and shows the error |
| `clayform compare <scene> <reference.png> [--view front] [-o overlay.png]` | fit a model to a reference image |
| `clayform layout <file.layout.json> [--render out.png] [--export out.glb] [--triangles N]` | check, render and export a [layout](layouts.md) |
| `clayform guide` | print the agent manual |

## Library

```ts
import {
  getTemplate, applyOps, buildScene, critique, formatReport,
  renderSheet, renderClipStrip, simplifyBuild, exportGlb, bakeEffect, resolveEffect
} from 'clayform';

const edited = applyOps(getTemplate('robot')!.scene, [
  { op: 'set_palette', set: { metal: '#f2c14e' } }
]);
if (!edited.ok) throw new Error(edited.error);

const build = buildScene(edited.scene);            // mesh + attributes
console.log(formatReport(critique(build)));         // critics
const sheet = renderSheet(build, { mode: 'parts' }); // PNG bytes + legend
const glb = exportGlb(await simplifyBuild(build, { triangles: 4000 })).glb;
```

Main entry points:

| function | returns |
|---|---|
| `parseScene(json)` | `{ ok, scene }` or `{ ok: false, error }`, with a readable error |
| `applyOps(scene, ops)` | a new scene or an error. Atomic |
| `buildScene(scene, { resolution?, ao? })` | `Build`: meshes, bounds, cell size, stats |
| `critique(build)` | `Report`: issues + stats |
| `renderSheet(build, { views, mode, size })` | `{ png, legend, views }` |
| `renderClipStrip(build, clipId, { frames, view })` | film strip PNG |
| `simplifyBuild(build, { triangles?, error? })` | a reduced `Build` |
| `exportGlb(build, { bakeAo?, rig?, clips? })` | `{ glb, json, stats }` |
| `bakeEffect(resolveEffect(scene, effect))` | `{ sheet, preview, meta }` |
| `fitReference(build, png, view)` | `{ iou, aspect, advice, overlay }` |
| `Workspace` | named scenes on disk with undo/redo and snapshots, as the MCP server uses them |
