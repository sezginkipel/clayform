# Roadmap

Clayform is built around one idea: the agent edits meaning, and Clayform turns it into geometry
it can see and measure. Each milestone either widens what agents can make or proves that what
they make is good. The order is the priority. There are no dates, because the work moves as fast
as it can be verified, not on a calendar.

Progress is tracked in [GitHub milestones](https://github.com/sezginkipel/clayform/milestones).

## ✅ v0.1 — The workshop (released 2026-09-28)

- Semantic scene document: attach by side, embed, mirror, carve, intersect, blend, patterns, detail
- SDF meshing with surface nets and anchored sculpts
- Software renderer with named views and a parts view with legend
- Critics: floating/split, buried, too small/thin, symmetry, tipping, budget, fused limbs
- Automatic rig, 12 clip types, keyframe tracks, motion checks
- 10 effect presets baked to flipbooks
- glTF export with skin and animations, triangle budgets; validated with the Khronos validator
- MCP server (13 tools), CLI, three.js viewer, 19 templates, 34 tests

## ✅ v0.2 — Imported meshes and motion checks (released 2026-09-28)

- Imported GLB/OBJ meshes as parts: they blend, carve, anchor and mirror like any part
- A motion critic for parts passing through each other during a clip
- `clayform view --watch`: live reload while an agent edits
- Full docs, a generated scene reference and JSON Schema, and docs examples run as tests

## ✅ v0.3 — Crisp and measurable (released 2026-09-28)

- Sharp edges with dual contouring and split normals for hard-surface models
- `measure`: surface distances and overlap depth, sizes, ratios, the part at a pixel
- Before/after renders of the last edit

## v0.4 — Match a reference

Give the agent a concept sketch or photo and it can move a model toward it with a number that
goes up and concrete directions, without a generative model.

- **Silhouette fit per view**: IoU against a reference image, with an overlay of what is missing and what is extra
- **Where and how it differs**: band-by-band width comparison turned into sentences that name the part
- **Image/text → 3D hand-off** (opt-in): generate an organic base and import it as a mesh part

## v0.5 — Readable in a game

Models that read well at the size a player sees them.

- Neighbouring parts whose colors blend together (contrast and hue difference after shading)
- Details too small for the game camera (render at the target on-screen height)
- Silhouettes that look the same from every side

## v0.6 — Asset packs for engines

A consistent set of assets that imports into Godot, Unity or Unreal without hand fixes.

- Style sheets shared across a pack (palette, bevel, scale reference), with critics for drift
- Multi-object scenes and layouts, a searchable part library, more templates
- LOD chains and collision hulls; tested import guides per engine
- Faster rebuilds (worker threads, incremental builds)

## v0.7 — Textures

- UV unwrapping and baked textures, a shared atlas, toon and flat-shaded export options

## v0.8 — Motion that holds up

- Two-bone IK and foot planting, clip blending, secondary motion, more clip types

## v0.9 — Proven

- The bench against Blender MCP, run and published
- An unattended agent eval (`clayform eval`) that runs the bench prompts with a real model and catches regressions in CI

## v1.0 — Stable

- The `clayform/1` scene format frozen, with migrations for anything after it
- Published bench results, re-run every release
- An npm release and a documentation site
- A remote MCP server (HTTP) for hosted use

## Not planned

- A general-purpose modeling UI (Blender exists and is excellent)
- Photoreal materials and film-quality rendering
- Features that only look good in a demo and cannot be measured by a critic or the bench

Ideas and requests: [open an issue](https://github.com/sezginkipel/clayform/issues).
