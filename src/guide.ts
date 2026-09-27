/** The manual an agent reads (MCP `guide` tool, `clayform guide`). Keep it tight. */

export const GUIDE = `# Clayform — how to build 3D here

You edit a **scene document**; Clayform meshes it, renders it for you, measures it,
rigs it and exports it. You never place vertices.

## Workflow that works
1. \`list_templates\` → \`new_scene\` from the closest template (far better than from scratch).
2. \`render\` (default: front, left, top, three_quarter). Use \`mode: "parts"\` to see which
   part is which — every part gets a color and the legend names it.
3. \`edit\` with a batch of ops. Batches are atomic; errors say which op and why.
4. Read the critics returned by \`edit\`/\`inspect\`. They measure what pictures hide:
   floating or split pieces, buried parts, detail lost to resolution, broken symmetry,
   tipping over, parts that will stretch in animation. Fix every ERROR and WARN.
5. Add clips (\`add_clip\` with a type) → \`preview_motion\` to see frames.
6. \`export\` (glb for engines; \`triangles\` sets a budget, default keeps shape within 0.4%).

## Conventions
Meters. +Y up. The model faces **+Z** (front). The model's own **left is +X**.
Rotations are Euler degrees [x, y, z]. Ground is y=0; with \`settings.ground: "auto"\`
(default) the model is dropped/lifted to stand on it.

## Parts
\`\`\`json
{ "id": "head", "role": "head", "shape": { "type": "sphere", "radius": 0.2 },
  "attach": { "to": "body", "side": "top", "embed": 0.2 }, "blend": 0.05,
  "material": { "color": "skin" } }
\`\`\`
- **shape.type**: sphere{radius} · ellipsoid{radii[3]} · box{size[3], rounding} ·
  capsule{length, radius} (along local Y) · cylinder{height, radius, rounding, sides} ·
  cone{height, radius, topRadius, rounding, sides} · torus{radius, tube} (ring in XZ) ·
  prism{size[3]} (triangle in XY, peak up, extruded along Z) · tube{points[], radius | radii[]}
  (smooth swept tube: tails, limbs, horns). \`sides\` makes facets (6 = crystal, 4 = pyramid).
- **Placement** — one of:
  - \`attach\`: \`{ to, side, offset?, embed?, align? }\` puts the part on another part's surface.
    \`side\` is a world direction you look from: top, bottom, front(+Z), back, left(+X), right, center.
    Without offset it picks the extreme point that way (the tip of a tilted arm).
    \`offset: [u, v]\` slides across that side in -1..1 of the target's half size
    (top/bottom: [x, z] · front/back: [x, y] · left/right: [z, y]).
    \`embed\`: 0 touching, 0.35 default, 1 = center on the surface, negative = gap.
    \`align: true\` points the part's local +Y along the surface normal (horns, spikes, noses).
    Attached parts keep their own rotation; \`position\` adds a world offset after placing.
  - \`parent\`: position/rotation relative to that part, and it follows its rotation.
  - neither: \`position\` is world.
- \`op\`: add (default) · carve (cuts every part listed BEFORE it — order matters) · intersect.
- \`blend\`: smooth-merge radius (m) with everything before it. 0 = hard seam.
- \`mirror: true\` adds a twin across X named \`id.m\`. Parts attached to a mirrored part are
  mirrored too (set \`mirror: false\` to stop that).
- \`separate: true\` meshes it on its own (wheels, rotors, held props). Otherwise all parts fuse.
- \`material\`: color (#hex or palette key), roughness, metalness, emissive, emissiveStrength.
- \`pattern\`: { kind: spots|stripes|noise|gradient, color, scale, amount, axis: x|y|z|around }.
- \`detail\`: { amount, scale } bumpy surface (rock, bark, foliage).
- \`role\`: body, head, leg, arm, tail, wing, wheel, rotor, eye, ear … animation reads it.
- \`pivot\`: joint location for animation (default: the attach point).
- \`hidden: true\` keeps a part as an invisible anchor.

## Sculpting (anchored, no brushes)
\`\`\`json
{ "id": "cheek", "kind": "inflate", "at": { "to": "head", "side": "front", "offset": [0.5, -0.2] },
  "radius": 0.06, "amount": 0.015, "mirror": true }
\`\`\`
kinds: inflate · dent · flatten (cuts \`amount\` deep, plane from the surface normal or \`normal\`) ·
crease (groove from \`at\` to \`to\`, width = radius, depth = amount) · noise (omit \`at\` for global).
\`at\` can also be \`{ "point": [x, y, z] }\`.

## Animation (intent, not keyframes)
\`{ "id": "walk", "type": "walk", "speed": 1, "amplitude": 1 }\` — types: idle walk run hop
fly swim drive spin hover wave nod keyframes. Legs pair by side (bipeds alternate,
quadrupeds trot diagonally), arms counter-swing, wheels roll, rotors spin, tails sway.
\`tracks: [{ part, keys: [{ t, rotation: [deg], offset: [m] }] }]\` layers keyframes on top
(or alone with type "keyframes"). Rotations turn a part about its pivot in world axes.

## Effects
\`{ "id": "flame", "preset": "fire" }\` — presets: fire smoke sparks magic explosion dust snow
rain bubbles heal. Override count, lifetime, speed, spread, gravity, drag, size, colors,
alpha, emitter, blend, burst, duration, frames, tile. \`preview_effect\` shows frames;
\`export\` with format "flipbook" writes a sprite sheet PNG + JSON.

## Edit ops
add_part{part, after?} · update_part{id, set} · remove_part{id, cascade?} · rename_part{id, to} ·
duplicate_part{id, as, set?} · add_sculpt / update_sculpt / remove_sculpt ·
add_clip / update_clip / remove_clip · add_effect / update_effect / remove_effect ·
set_settings{set} · set_palette{set} · set_meta{name?, notes?} · replace{scene}.
\`set\` merges objects, replaces arrays, and \`null\` removes a field.

## Settings
resolution (cells on the longest axis, default 96; raise for thin parts) · ground auto|none ·
symmetry "x" (critics check it) · budget (triangle budget) · ao · rig auto|none.

## Tips
- Recolor with the palette: change \`palette.skin\` once.
- Proportions come from templates; stretch with \`scale\` rather than rewriting shapes.
- Thin parts (< 2 cells) vanish: raise resolution or mark them separate.
- A carve only cuts parts listed before it — put parts that must stay whole after the carve.
- Parts that move on their own (legs, arms, wings, tails) must not touch unrelated parts.
`;
