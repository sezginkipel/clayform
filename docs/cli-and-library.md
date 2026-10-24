# CLI and library

## CLI

Wherever a command takes a scene, you can also give a template id.

| command | does |
|---|---|
| `clayform mcp [--workspace dir]` | start the MCP server on stdio |
| `clayform templates` | list templates |
| `clayform new <template> [-o file]` | write a template as a `.clay.json` |
| `clayform render <scene> [-o png] [--views front,left] [--mode parts] [--size 384]` | render a sheet (prints the legend and critics) |
| `clayform beauty <scene> [-o png] [--light studio\|sunset\|overcast\|night] [--background transparent\|#rrggbb] [--size 1024] [--clip walk] [--turntable 36 --seconds 4]` | a [presentation render](mcp-tools.md#beauty), or a turntable as an animated PNG |
| `clayform inspect <scene>` | part summary, critics and clip checks. Exit code 2 on errors, so it can gate CI |
| `clayform export <scene> [-o out.glb\|out.obj] [--triangles N] [--texture 1024] [--shading flat\|toon] [--outline 0.01]` | export |
| `clayform kit <scene> [more …] [-o dir] [--atlas 2048] [--embed]` | several models sharing one [texture atlas](export.md#kits) |
| `clayform serve [--port 8787] [--token T] [--workspace dir]` | the MCP tools over HTTP, a sandboxed workspace per session ([hosting](mcp-tools.md#hosting-over-http)) |
| `clayform migrate <scene.clay.json> [-o out]` | upgrade a file from an older format ([format stability](format.md)) |
| `clayform motion <scene> [clip] [-o png] [--view left] [--frames 6]` | film strip |
| `clayform effect <scene> [effect] [-o png]` | flipbook + `.json` + `.preview.png` |
| `clayform view <scene\|template\|file.glb> [--port 5231] [--watch]` | local three.js viewer that plays clips. `--watch` reloads when the scene file changes, and when an edit is invalid it keeps the last good version and shows the error |
| `clayform compare <scene> <reference.png> [--view front] [-o overlay.png]` | fit a model to a reference image |
| `clayform layout <file.layout.json> [--render out.png] [--export out.glb] [--triangles N]` | check, render and export a [layout](layouts.md) |
| `clayform auto-fix <scene> [-o out.clay.json]` | atomically apply self-healing `suggested_ops` from the critics |
| `clayform validate-engine <file.glb> [--engine godot\|unity\|unreal]` | verify `.glb` binary structure, `SOCKET_*` nodes, and engine collision conventions |
| `clayform eval [--templates] [--bench dir] [--engine godot\|unity\|unreal] [-o report.md]` | run the automated evaluation harness and emit a markdown/JSON benchmark report |
| `clayform sync <scene> --engine <godot\|unity\|unreal> --project <dir> [--watch]` | live-sync `.glb` + engine sidecar (`.glb.import` / `.clayform.json`) into a game project |
| `clayform pack <name> <item...> [-o dir] [--style file] [--shading toon\|flat]` | build a cohesive multi-asset pack with a shared atlas and physics-settled layout |
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
| `exportGlb(build, { bakeAo?, rig?, clips?, lods?, collision?, naming?, texture?, shading?, bands?, outline? })` | `{ glb, json, stats, atlas? }` |
| `exportKit(items, { atlas?, embed?, shading?, … })` | `{ atlas, files }` |
| `bakeAtlas(sources, { size?, padding?, bakeAo?, toonBands? })` | `{ size, png, meshes, charts, coverage, texelsPerMeter }` |
| `bakeEffect(resolveEffect(scene, effect))` | `{ sheet, preview, meta }` |
| `fitReference(build, png, view)` | `{ iou, aspect, advice, overlay }` |
| `syncToEngineProject(build, { engine, projectDir, … })` | `{ glbPath, sidecarPath, validation, stats }` |
| `buildAssetPack({ name, assets, dir, … })` | `{ dir, files, atlasPath, layoutGlbPath, previewPngPath, manifestPath }` |
| `generate3DMesh(prompt, { provider, apiKey?, endpoint? })` | `{ format, data }` (free local endpoint or BYOK cloud API) |
| `Workspace` | named scenes on disk with undo/redo and snapshots, as the MCP server uses them |

