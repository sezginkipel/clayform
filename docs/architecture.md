# Architecture

```
scene JSON ──► schema (zod, strict) ──► compile ──► build ──► critics
                                          │           │
                                          │           ├─► render (software) ──► PNG
                                          │           ├─► rig + clips ──► pose / film strip
                                          │           └─► simplify ──► glTF / OBJ
                                          └─► effects ──► flipbook
```

| file | responsibility |
|---|---|
| `src/core/schema.ts` | the document. Strict zod schema plus `integrity()` for cross-references (unique ids, references that exist, no cycles, palette keys) |
| `src/core/ops.ts` | atomic edit ops (a copy is edited, then the whole result is validated) |
| `src/core/sdf.ts` | distance primitives (incl. faceted cylinders and cones, swept tubes), smooth min / subtract / max, value noise and Worley noise |
| `src/core/compile.ts` | resolves world poses in dependency order: attach by sphere tracing, extreme-point anchors, embed, mirror twins and inheritance, pivots; compiles sculpts to field modifiers; evaluates the field |
| `src/core/mesher.ts` | surface nets over a grid split into 4³ blocks. A block that no primitive can reach is skipped, and a block far from any surface is filled with a single value |
| `src/core/build.ts` | meshes the fused body and separate parts; per vertex: normal, AO, blended color and pattern, dominant part, skin weights; ground offset |
| `src/core/simplify.ts` | meshoptimizer quadric simplification with color, normal and material attributes |
| `src/critic/critics.ts` | the measurements (see [critics](critics.md)) |
| `src/render/*` | deferred software rasterizer, named views and framing, a 5×7 font, PNG encoder, film strips |
| `src/anim/rig.ts` | joints from parts, procedural clips by role, keyframe tracks, CPU skinning, motion checks |
| `src/vfx/effects.ts` | presets, closed-form particles, flipbook and preview |
| `src/export/gltf.ts` | GLB writer (materials, skin, animations), OBJ |
| `src/mcp/*` | MCP server and tool handlers |
| `src/session.ts` | the workspace: scenes on disk, undo/redo, snapshots, build cache, summaries |
| `src/templates/index.ts` | the tuned starting points |

## Performance notes

- `primDist` and `noise3` are the hot path, called millions of times per build. They are written
  without allocation or closures. Making them so sped up field evaluation 13×.
- A block's list of relevant primitives and sculpts is cached, together with a local Lipschitz
  bound (surface detail and sculpts raise it), so only the shell near the surface is sampled densely.
- Typical builds take 0.1–0.7 s on a laptop at resolution 96–120. A four-view render takes about 1 s.

## Design choices

- **World-direction anchors.** Anchors on a part's local axes made "front" point down on a
  body lying on its side, and that confuses agents.
- **Attach does not inherit rotation.** A nose on a tilted head should point where the agent
  said, not where the head happens to point. `parent` exists for hierarchies.
- **Skin weights follow the attach hierarchy**, not only distance. Distance alone let a hand near
  the hip follow the leg.
- **A cavity takes the carve's color.** A vertex deep inside an added part lies on a carved
  surface, so the carve's color wins there.
- **A small tool schema.** `edit.ops` is typed loosely in the MCP tool list and validated on the
  server with readable messages. The full schema is one `guide` call away, so it does not cost
  thousands of tokens in every session.
