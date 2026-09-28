# Export

## glTF (`.glb`)

- **One mesh for the fused body**, plus one mesh per `separate` part.
- **One primitive per material** (by roughness, metalness and emission). Base color lives in
  `COLOR_0` (linear), and the material's base color factor is white. Ambient occlusion is
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

## OBJ

Static geometry with per-vertex colors (`v x y z r g b`) and normals.

## Scene JSON

`format: "json"` writes the document. It is the source of truth, so keep it next to the GLB.
The `.clay.json` files validate against [`schema/clayform.schema.json`](../schema/clayform.schema.json).
