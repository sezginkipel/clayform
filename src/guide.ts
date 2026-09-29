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
6. Ask \`measure\` when a number matters (a gap, an overlap, a proportion, what part is at a
   pixel), and use \`render { compare: "previous" }\` to see exactly what your last edit changed.
7. Working from a picture? \`compare_reference { image, view }\` scores the silhouette against it and
   names the parts that are too wide or narrow. Fix the biggest difference, compare again.
8. \`export\` (glb for engines; \`triangles\` sets a budget, default keeps shape within 0.4%;
   \`texture: 1024\` bakes colors into a texture for engines that ignore vertex colors;
   \`shading: "toon"\` + \`outline: 0.01\` for a cel look; \`export_kit\` for a set sharing one atlas).

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
  (smooth swept tube: tails, limbs, horns) · mesh{src, size?, resolution?} (an imported .glb or
  .obj, baked to a distance field so it blends, carves and anchors like any part; color comes
  from material). \`sides\` makes facets (6 = crystal, 4 = pyramid).
  lathe{profile[[r, y]…], smooth?, shell?, sides?} (spun around Y: vases, columns, bottles; shell =
  open-topped wall: cups, bowls, lamp shades) · extrude{outline[[x, y]…], depth, rounding?, bevel?,
  taper?, smooth?} (signs, gears, keys, shields) · text{text, height, depth} (block letters) ·
  terrain{size[w, d], height, roughness?, scale?, seed?} (a ground tile of hills) ·
  sheet{size[w, h], thickness?, bend?, wave?{amplitude, length}} (really thin: leaves, flags, sails,
  paper, cloth; always its own mesh). mesh{…, keep: true} keeps the file's own triangles.
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
  \`only: "wall"\` (or a list) limits a carve/intersect to those parts, wherever they are listed.
- \`blend\`: smooth-merge radius (m) with everything before it. 0 = hard seam.
- \`mirror: true\` adds a twin across X named \`id.m\`. Parts attached to a mirrored part are
  mirrored too (set \`mirror: false\` to stop that).
- \`repeat: { count, step?, turn?, axis?, around?, rows? }\` copies a part and everything on it
  (window grids, posts, columns around a tower); \`scatter: { on, count, where?, minGap?, scale?,
  seed? }\` spreads copies over another part (spikes, rivets, rocks and trees on terrain).
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
\`{ "id": "walk", "type": "walk", "speed": 1, "amplitude": 1 }\` — loops: idle walk run hop
fly swim drive spin hover wave nod; one-shots: attack jump sit turn die; blend (\`from\`, \`to\`:
a crossfade that ends where \`to\` starts); keyframes. Legs pair by side (bipeds alternate,
quadrupeds trot diagonally) and walks plant the feet (export has extras.speed: move the
character at it). Arms counter-swing, wheels roll, rotors spin; tails, ears and antennas
follow through on a spring (\`secondary: false\` turns that off).
\`tracks: [{ part, keys: [{ t, rotation: [deg], offset: [m] }] }]\` layers keyframes on top
(or alone with type "keyframes"). Rotations turn a part about its pivot in world axes.

## Effects
\`{ "id": "flame", "preset": "fire" }\` — presets: fire smoke sparks magic explosion dust snow
rain bubbles heal. Override count, lifetime, speed, spread, gravity, drag, size, colors,
alpha, emitter, blend, burst, duration, frames, tile. \`preview_effect\` shows frames;
\`export\` with format "flipbook" writes a sprite sheet PNG + JSON.

## Edit ops
add_part{part, after?} · add_library_part{name, id, attach, size?, mirror?, color?} (see list_parts) ·
update_part{id, set} · remove_part{id, cascade?} · rename_part{id, to} ·
duplicate_part{id, as, set?} · add_sculpt / update_sculpt / remove_sculpt ·
add_clip / update_clip / remove_clip · add_effect / update_effect / remove_effect ·
set_settings{set} · set_palette{set} · set_meta{name?, notes?, style?, category?} · replace{scene}.
A style (a .style.json shared by a pack) supplies palette keys, material defaults and height
ranges per category; critics flag colors and sizes that drift from it.
\`set\` merges objects, replaces arrays, and \`null\` removes a field.

## Settings
resolution (cells on the longest axis, default 96; raise for thin parts) · edges soft|sharp
(sharp keeps real corners: crates, blades, buildings, robots) · ground auto|none ·
symmetry "x" (critics check it) · budget (triangle budget) · screenHeight (px the model is tall in
the game; critics flag details a player cannot see) · ao · rig auto|none.

## Layouts
\`set_layout\` places many scenes or templates together: items with a position, yaw and scale,
and patterns (row, grid, circle, scatter). \`render_layout\` checks that items do not pass through
each other; \`export_layout\` writes one GLB.

## Tips
- Recolor with the palette: change \`palette.skin\` once.
- Proportions come from templates; stretch with \`scale\` rather than rewriting shapes.
- Thin parts (< 2 cells) vanish: raise resolution or mark them separate.
- A carve only cuts parts listed before it — put parts that must stay whole after the carve.
- Parts that move on their own (legs, arms, wings, tails) must not touch unrelated parts.
`;
