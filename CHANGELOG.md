# Changelog

## Unreleased

- Docs: getting started, concepts, MCP tools, critics, animation, effects, export, CLI and library,
  architecture, FAQ. Scene reference, template catalog and `schema/clayform.schema.json` are
  generated from the code, and every JSON example in the docs marked `verify` is run by the test suite.
- Every scene field now has a description, both in the JSON Schema and for agents.
- Roadmap and GitHub milestones.

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
