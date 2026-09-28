# Changelog

## 0.4.0 — 2026-09-28

- **`compare_reference`** fits the model to a sketch or photo seen from one side. The reference is
  registered onto the model by the scale and shift that overlap them best, so a change to one part
  stays at that part. It returns an IoU score, an overlay (orange = only in the reference, blue =
  only in the model) and sentences that name the parts that are too wide or narrow. (#25, #26)
- Reference backgrounds are found by a flood fill from the border, so light areas inside the object
  still count as the object.
- `clayform compare <scene> <reference.png>` does the same from the command line.
- A PNG decoder (8-bit gray, RGB, RGBA and palette images).

## 0.3.0 — 2026-09-28

- **Sharp edges.** `settings.edges: "sharp"` places vertices by dual contouring, so box corners land
  on the corner (0.05 cells away instead of 1.15) and normals split where faces meet steeply. The
  house, chest, sword, robot and crystal templates use it. (#22)
- **`measure` tool.** Surface distance between parts (negative when they overlap, even when
  they blend together), part size and bounds, ratios, and which part is at a pixel of a render. (#23)
- **`render { compare: "previous" }`** shows the state before the last edit above the current one,
  with one camera, and lists what changed. (#24)

## 0.2.0 — 2026-09-28

- **Imported meshes as parts.** A `mesh` shape loads a `.glb` or `.obj`, bakes it into a distance
  grid and from then on it attaches, blends, carves, mirrors and goes through the critics like
  any other part. Open meshes are kept as a thin shell, with a warning. (#2)
- **Clips are checked for parts passing through each other.** `inspect` and `preview_motion` say
  which parts collide, when, and how deep. Overlaps that already exist at rest are ignored. (#4)
- **`clayform view --watch`** reloads the viewer when the scene file changes, keeps the last good
  version when an edit is invalid, and shows the error. (#6)
- Palette errors now say what a valid name and color look like.
- Docs: getting started, concepts, MCP tools, critics, animation, effects, export, CLI and library,
  architecture, FAQ. The scene reference, template catalog and `schema/clayform.schema.json` are
  generated from the code, and every docs example marked `verify` runs in the test suite.
- Every scene field has a description, both in the JSON Schema and in what agents read.

## 0.1.0 — 2026-09-28

First public release.

- Semantic scene document (`clayform/1`): parts with ids and roles, `attach` by world side with
  extreme-point anchors, `embed`, `align`, `mirror` (inherited by attached children), `parent`,
  `separate`; `add` / `carve` / `intersect` with smooth `blend`; patterns, surface detail, palette.
- Shapes: sphere, ellipsoid, box, capsule, cylinder and cone (optionally faceted), torus, prism, swept tube.
- Anchored sculpts: inflate, dent, flatten, crease, noise.
- Signed-distance meshing with block-culled surface nets.
- Software renderer: named orthographic and perspective views, ground with key and contact shadows,
  parts view with legend, clay, normals and depth modes, labelled sheets.
- Critics: floating and split pieces, buried and too-small parts, thin parts, separate-part gaps,
  symmetry, tipping, triangle budget, fused independently-moving parts.
- Automatic rig and clips (idle, walk, run, hop, fly, swim, drive, spin, hover, wave, nod,
  keyframes) with role-based gaits; CPU skinning, film strips, motion checks.
- Effects: fire, smoke, sparks, magic, explosion, dust, snow, rain, bubbles, heal, as flipbook + JSON.
- Export: GLB (materials, vertex colors, skin, animations, emissive strength) and OBJ;
  meshoptimizer simplification to a triangle budget.
- MCP server with 13 tools, CLI, `clayform view` (three.js), 19 templates.
