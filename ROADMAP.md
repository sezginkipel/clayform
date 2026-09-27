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

## v0.2 — Prove it and see more

The goal is to know, not guess, how good the output is, and to break the stylized-only ceiling.

- **Run and publish the bench**: 20 prompts, Clayform vs. Blender MCP, blind judging ([protocol](bench/README.md))
- **Imported meshes as parts**: GLB/OBJ turned into a distance field, so they blend, carve and anchor like any part
- **Image/text → 3D hand-off** (opt-in, bring your own key or run an open-weight model): generate
  an organic base, import it, and let the agent edit, rig and check it
- **Motion critic for self-intersection**: limbs passing through the body during a clip
- **Faster iteration**: build in worker threads, rebuild only the parts that changed
- `clayform view --watch`: live reload while an agent edits

## v0.3 — Rigs that move like bodies

- Two-segment limbs with two-bone IK and foot planting on uneven ground
- Clip blending and transitions (idle → walk → run)
- Secondary motion (tails, ears, antennas follow through)
- More clip types: attack, jump, sit, turn, die

## v0.4 — Kits and worlds

- Multi-object scenes: instances and layouts (a dungeon kit, a street, a forest patch)
- A reusable part library beyond templates, searchable by tag
- 40+ templates across characters, creatures, vehicles, buildings and props
- LOD chains and collision hulls in the export
- Tested import guides for Godot, Unity and Unreal

## v0.5 — Textures

- UV unwrapping (xatlas) and baked base color / ORM textures
- A texture atlas shared across a kit
- Export options for toon and flat-shaded styles

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
