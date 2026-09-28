# Export

## glTF (`.glb`)

- **One mesh for the fused body**, plus one mesh per `separate` part.
- **One primitive per material** (by roughness, metalness and emission). Base color lives in
  `COLOR_0` (linear), or in a baked texture with [`texture`](#textures), and the material's base
  color factor is white. Ambient occlusion is
  multiplied into the vertex colors by default (`bakeAo: false` turns this off).
- **Emission** uses `emissiveFactor`, plus `KHR_materials_emissive_strength` when the strength is above 1.
- **With clips**: a skin with one joint per part under `root`, `JOINTS_0`/`WEIGHTS_0`, and one
  animation per clip (rotation, translation, and scale on `root` for squash and stretch), sampled
  at the clip's fps with linear interpolation.
- **Names**: nodes use part ids. Mirror twins are `<id>_mirror` (engines treat `.` specially in
  animation paths), and skinned mesh nodes end in `_mesh` so they never collide with a joint name.

The test suite runs every export kind through the [Khronos glTF validator](https://github.com/KhronosGroup/glTF-Validator)
and requires zero errors. The skinned walk has also been checked playing in three.js. Other engines
import standard glTF 2.0, but they have not been tested yet. Reports are welcome.

## Triangle budgets

Meshing works at `settings.resolution`, which is dense (surface nets spends as many triangles on
a flat wall as on a nose). Export simplifies with meshoptimizer while keeping color seams,
normals and material borders:

- Default: remove everything that keeps the shape within **0.4%** of the model size.
- `triangles: N`: reduce to at most N across all meshes, shared by size.

Measured on the templates: the cottage goes from 149,804 to 6,324 triangles by default, and
the toy car from 147,784 to 3,992 with `triangles: 4000`, with no visible difference in the
renders.

## Levels of detail and collision

`export { lods: [0.5, 0.2], collision: "parts", engine: "godot" }`

- **lods** adds lower levels of detail as fractions of the exported triangle count. Meshes are named
  `<name>_LOD0`, `_LOD1` … and, for static models, grouped under one parent so importers that build
  LOD groups from sibling names find them.
- **collision** adds convex hulls: `parts` gives one per part (a compound collider that follows the
  model's own structure), and `hull` gives one for the whole model. Each hull has at most 255 vertices
  and sits up to one grid cell inside the surface.
- **engine** names the collision nodes the way that engine picks them up: Godot `-convcolonly`,
  Unreal `UCX_body_00` …, Unity `_collider`, otherwise `_collision`.

The CLI takes the same options: `clayform export chest -o chest.glb --lods 0.5,0.2 --collision parts --engine godot`.
The Khronos validator reports zero errors for all four naming styles. Importing into each engine is
not tested yet ([#15](https://github.com/sezginkipel/clayform/issues/15)).

## Textures

`export { texture: 1024 }` · `clayform export biped --texture 1024`

Many engine materials ignore vertex colors (Unity's standard shader, for one). With `texture` the
colors go into a baked atlas instead:

- **Unwrapping.** Triangles that face the same axis and share an edge form a chart, and each chart
  is projected flat onto that axis plane. A surface tilted away from its axis gets fewer texels,
  at worst 58% of the density along one direction (at 55°, where the axes tie). Vertices are split
  only along chart seams.
- **Packing.** Charts are laid landscape and packed tallest first, each at the lowest spot that
  fits (skyline packing). The texel size is then bisected down to the sharpest one that still fits.
- **Painting.** Each texel is painted from the parts themselves at that point on the surface, so
  stripes and spots come out sharper than the vertices could hold, and ambient occlusion is
  multiplied in. Triangles smaller than a texel still paint the texels under their corners, and a
  2-texel gutter is grown around every chart so filtering and mipmaps never reach the background.
- **Output.** `TEXCOORD_0` and a PNG `baseColorTexture` (clamped, trilinear) embedded in the GLB.
  `COLOR_0` is left out so the color is not applied twice.

The test suite samples the atlas at every vertex's UV and requires the median difference from
the vertex color to stay under 2%. For the biped at 8,000 triangles, a 1024 px atlas holds
189 charts, fills 46% of the texture, and gives 589 texels per meter.

## Flat, toon and outlines

`export { shading: "flat" | "toon", bands: 3, outline: 0.01 }`

- **flat** gives every triangle its own vertices with the face normal, for a faceted low-poly look.
  It combines with any other option. The file gets bigger because vertices are no longer shared.
- **toon** bakes the light into `bands` flat steps (from 55% to full brightness, darker in occluded
  creases) and marks the materials `KHR_materials_unlit`, so the engine shows the steps as they are.
  The bands go into the vertex colors, or into the texture when `texture` is set.
- **outline** adds an inverted hull for each mesh: the surface pushed out by that many meters,
  with its winding flipped and an unlit near-black material. With back-face culling only a rim
  shows around the model. Where sharp edges split the normals, the hull uses the welded average,
  so it does not tear. Outlines carry the skin, so they follow animation.

The CLI takes the same options: `clayform export biped --shading toon --outline 0.01 --texture 1024`.

## Kits

`export_kit { scenes: ["barrel", "chest", "torch"], atlas: 2048 }` ·
`clayform kit barrel chest torch -o kit --atlas 2048`

A kit is a set of models exported as separate GLBs that are painted from one shared atlas. Every
GLB points at `atlas.png` next to it (or embeds a copy with `embed`), so an engine loads the
texture once and can draw the whole kit with one material. The charts of every model are packed
together, and the test suite checks that no texel is claimed by two models. Shading, outlines,
collision and engine naming work the same as for a single export.

Five props (barrel, chest, torch, potion, sword at 3,000 triangles each) share one 1024 px atlas
with 811 charts, filling 43% of it.

## OBJ

Static geometry with per-vertex colors (`v x y z r g b`) and normals.

## Scene JSON

`format: "json"` writes the document. It is the source of truth, so keep it next to the GLB.
The `.clay.json` files validate against [`schema/clayform.schema.json`](../schema/clayform.schema.json).
