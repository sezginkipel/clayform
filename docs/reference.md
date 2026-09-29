# Scene reference

> Generated from `src/core/schema.ts` by `scripts/gen-docs.ts`. Do not edit by hand.
> Unknown fields are rejected, so a typo is an error rather than something silently ignored.

Conventions: meters, +Y up, the model faces +Z, the model's left is +X, rotations are Euler degrees applied X → Y → Z.

## Scene

| field | type | meaning |
|---|---|---|
| `format` **required** | `"clayform/1"` | document version |
| `name` **required** | string | display name; also the glTF scene name |
| `notes` | string | free text: intent, constraints, what to keep |
| `palette` | { key: string } | named colors parts refer to — recolor a model by editing one entry |
| `style` | string or object | a style sheet (path to a .style.json, or inline) shared across a pack: palette, material defaults, settings, height ranges |
| `category` | string | what this is in the pack (character, prop, building …); the style checks its height |
| `settings` | object | see Settings |
| `parts` **required** | object[] | in blend order: blend and carve act on the parts listed before them |
| `sculpts` | object[] | applied in order after all parts |
| `expressions` | object[] | faces the model can make, exported as morph targets; clips blink, talk and show them |
| `clips` | object[] | animations; the rig is built automatically |
| `effects` | object[] | particle effects baked to flipbooks |

## Settings

| field | type | meaning |
|---|---|---|
| `resolution` | integer (≥16, ≤256) | cells along the longest axis (detail vs. triangles), default 96 |
| `ground` | `auto` · `none` | auto lifts/drops the model so it stands on y=0 (default) |
| `symmetry` | `x` · `none` | declare mirror symmetry so critics check it |
| `budget` | integer (≥100, ≤2000000) | triangle budget for critics |
| `screenHeight` | integer (≥16, ≤2048) | how tall the model appears in the game, in pixels; critics flag details a player cannot see at that size |
| `ao` | boolean | compute ambient occlusion into vertex shading (default true) |
| `edges` | `soft` · `sharp` | soft (default) rounds edges to the cell size, good for organic shapes; sharp keeps real corners and edges (crates, blades, buildings, robots) |
| `rig` | `auto` · `none` | auto: skeleton from parts when clips exist |

## Part

| field | type | meaning |
|---|---|---|
| `id` **required** | string | unique snake_case id; a mirror twin is id + ".m" (exported to glTF as id_mirror) |
| `role` | string | semantic role used by animation and critics: body, head, leg, arm, tail, wing, wheel, rotor, eye, ear, horn, prop … |
| `label` | string | free text for people |
| `shape` **required** | one of `sphere`, `ellipsoid`, `box`, `capsule`, `cylinder`, `cone`, `torus`, `prism`, `mesh`, `sheet`, `lathe`, `extrude`, `text`, `terrain`, `tube` | see Shapes |
| `position` | [number, number, number] | relative to parent; with attach it is an extra world offset |
| `rotation` | [number, number, number] | Euler degrees XYZ |
| `scale` | number (>0) or [number (>0), number (>0), number (>0)] | uniform or per local axis; the easy way to stretch a template part |
| `parent` | string | position/rotation are relative to this part and follow its rotation (ignored when attach is set) |
| `attach` | Anchor | place on another part's surface; the part keeps its own rotation (use align to point it along the surface normal) |
| `op` | `add` · `carve` · `intersect` | add (default) merges, carve cuts away, intersect keeps only the overlap |
| `only` | string or string[] | carve/intersect: cut only these parts (and their mirror twins) instead of everything listed before — a window through one wall, a roof clipped to its own box |
| `blend` | number (≥0, ≤1) | smooth merge radius in meters with everything before it; 0 = hard seam |
| `cloth` | object | flutter: a separate part (a sheet: flag, cape, sail, banner) ripples in every clip, baked as four morph targets |
| `curve` | number (≥-2, ≤2) | bend the part along its local X: both ends rise this many meters above the middle (a smiling mouth, an arched brow, a banana); negative drops them |
| `material` | object | see Material |
| `pattern` | object | see Pattern |
| `detail` | object | see Detail |
| `mirror` | boolean | add a mirrored twin across X (id + ".m") |
| `repeat` | object | copies of this part and everything on it: window grids, fence posts, stairs, spokes, columns around a tower (ids id.2, id.3 …) |
| `scatter` | object | spread copies of this part over another part's surface: spikes on a back, rivets, flowers and rocks on terrain, moss on a roof |
| `separate` | boolean | mesh on its own instead of fusing into the body (wheels, props that spin, held items) |
| `pivot` | `center` · `top` · `bottom` · `front` · `back` · `left` · `right` · `attach` or [number, number, number] | joint location for animation; default: attach point, else top for legs/arms, else center |
| `hidden` | boolean | not meshed; still usable as an anchor or joint |

### Shapes

**`sphere`** — `radius`: number (>0)

**`ellipsoid`** — `radii`: [number (>0), number (>0), number (>0)]

**`box`** — `size`: [number (>0), number (>0), number (>0)] (full width, height, depth); `rounding`?: number (≥0) (edge radius in meters)

**`capsule`** — `length`: number (>0) (total length along local Y including both caps); `radius`: number (>0)

**`cylinder`** — `height`: number (>0) (along local Y); `radius`: number (>0); `rounding`?: number (≥0); `sides`?: integer (≥3, ≤16) (faceted: 6 = hexagonal prism (crystals, pencils, tiles); default round)

**`cone`** — `height`: number (>0) (along local Y, base at the bottom); `radius`: number (>0) (base radius); `topRadius`?: number (≥0) (0 = pointed (default)); `rounding`?: number (≥0); `sides`?: integer (≥3, ≤16) (faceted: 4 = pyramid, 6 = crystal point; default round)

**`torus`** — `radius`: number (>0) (ring radius, ring lies in the local XZ plane); `tube`: number (>0)

**`prism`** — `size`: [number (>0), number (>0), number (>0)] (triangular cross-section in XY (peak on top), extruded along Z — roofs, blades); `rounding`?: number (≥0)

**`mesh`** — `src`: string (path to a .glb or .obj (absolute, or relative to where the server runs / the workspace)); `size`?: number (>0) (scale so the longest axis is this many meters; default keeps the file's units); `resolution`?: integer (≥16, ≤160) (distance grid cells on the longest axis (default 64)); `keep`?: boolean (keep the file's own triangles (fine and sharp detail survives) instead of rebuilding it from the distance grid; it is then always a separate mesh)

**`sheet`** — `size`: [number (>0), number (>0)] (width (local X) and height (local Y); the sheet faces +Z); `thickness`?: number (>0) (meters (default 0.004): leaves, paper, cloth, flags, sails, cards); `bend`?: number (≥-340, ≤340) (total curl in degrees along its height, toward +Z (negative: toward -Z)); `wave`?: object (ripples across its width, like a flag or a curtain)

**`lathe`** — `profile`: [number (≥0), number][] ([radius, height] points from bottom to top, spun around local Y — vases, bottles, columns, lamp shades, chess pieces); `sides`?: integer (≥3, ≤16) (faceted around Y (6 = hexagonal); default round); `smooth`?: boolean (run a smooth curve through the points instead of straight segments); `shell`?: number (>0) (wall thickness: an open-topped wall along the profile instead of a solid — cups, bowls, vases, lamp shades, bells)

**`extrude`** — `outline`: [number, number][] (closed [x, y] outline in local XY (no crossings), pushed out along local Z — signs, gears, keys, shields, panels); `depth`: number (>0) (thickness along Z); `rounding`?: number (≥0) (round every edge by this radius); `bevel`?: number (≥0) (45° chamfer on the front and back rims); `taper`?: number (≥0.05, ≤4) (the front face is this many times the back face (1 = straight)); `smooth`?: boolean (run a smooth closed curve through the points instead of straight segments)

**`text`** — `text`: string; `height`: number (>0) (letter height in meters); `depth`: number (>0) (extrusion along Z); `rounding`?: number (≥0) (soften the block letters (default a sixth of a stroke))

**`terrain`** — `size`: [number (>0), number (>0)] (width (X) and depth (Z)); `height`: number (>0) (highest hills above the base); `base`?: number (>0) (solid thickness under the lowest point (default 0.3 × height)); `scale`?: number (>0) (feature size of the hills in meters (default a third of the width)); `roughness`?: number (≥0, ≤1) (0 = smooth rolling hills, 1 = broken rocky ground (default 0.4)); `seed`?: integer (≥-9007199254740991, ≤9007199254740991) (another seed, another landscape)

**`tube`** — `points`: [number, number, number][] (local points of a smooth swept tube — tails, limbs, horns, tentacles); `radius`: number (>0) or number (>0)[] (one radius, or one per point for tapering)

### Anchor (`attach`, and sculpt/effect `at`)

| field | type | meaning |
|---|---|---|
| `to` **required** | string | id of the part to attach to |
| `side` **required** | `top` · `bottom` · `front` · `back` · `left` · `right` · `center` | world direction you look at the target from: top=+Y bottom=-Y front=+Z back=-Z left=+X (the model's left) right=-X; center = its center |
| `offset` | [number (≥-1, ≤1), number (≥-1, ≤1)] | slide across that side, -1..1 of the target's half size in world axes (top/bottom: [x, z]; front/back: [x, y]; left/right: [z, y]) |
| `embed` | number (≥-1, ≤1.5) | how deep this part sinks in: 0 = just touching, 1 = its center sits on the surface, default 0.35, negative = gap |
| `align` | boolean | rotate this part so its local +Y points along the surface normal (horns, legs, spikes) |

A target can also be `{ "point": [x, y, z] }` in world space.

### Material

| field | type | meaning |
|---|---|---|
| `color` | string | #rrggbb, #rgb or a palette key; default a warm clay |
| `roughness` | number (≥0, ≤1) | 0 = mirror, 1 = matte (default 0.75) |
| `metalness` | number (≥0, ≤1) | 0 = dielectric (default), 1 = metal |
| `emissive` | string | glow color |
| `emissiveStrength` | number (≥0, ≤20) | glow multiplier (default 1; >1 exports KHR_materials_emissive_strength) |
| `preset` | object | a named surface: the colour becomes that material, with its grooves and, in textured exports, its relief and shine |

### Pattern

| field | type | meaning |
|---|---|---|
| `kind` **required** | `spots` · `stripes` · `noise` · `gradient` | spots (Worley cells), stripes, noise blotches, gradient along an axis |
| `color` **required** | string | the second color painted by the pattern |
| `scale` | number (>0) | feature size in meters (spots/stripes/noise); for gradient the height it fades over |
| `amount` | number (≥0, ≤1) | 0..1 how strongly the pattern color shows (default 1) |
| `axis` | `x` · `y` · `z` · `around` | stripes/gradient direction in the part's local axes; around = vertical staves around local Y. default y |

### Detail

| field | type | meaning |
|---|---|---|
| `amount` **required** | number (≥0, ≤0.5) | surface displacement in meters (rock, bark, lumps) |
| `scale` **required** | number (>0) | feature size in meters |

## Sculpt

| field | type | meaning |
|---|---|---|
| `id` **required** | string | unique sculpt id |
| `kind` **required** | `inflate` · `dent` · `flatten` · `crease` · `noise` | inflate/dent push out/in, flatten cuts a plane, crease cuts a groove from at to to, noise roughens |
| `at` | Anchor or { point: [x, y, z] } | where; required except for a global noise |
| `to` | Anchor or { point: [x, y, z] } | crease end point |
| `radius` **required** | number (>0) | area of influence in meters |
| `amount` **required** | number (≥0, ≤1) | meters: push for inflate/dent/noise, groove depth for crease, how deep flatten cuts |
| `normal` | [number, number, number] | flatten plane normal; default: the surface normal at `at` |
| `scale` | number (>0) | noise feature size |
| `mirror` | boolean | also apply at the mirrored position across X |

## Clip

| field | type | meaning |
|---|---|---|
| `id` **required** | string | clip id, becomes the glTF animation name |
| `type` **required** | `idle` · `walk` · `run` · `hop` · `fly` · `swim` · `drive` · `spin` · `hover` · `wave` · `nod` · `attack` · `jump` · `sit` · `turn` · `die` · `reach` · `point` · `pickup` · `look` · `blink` · `talk` · `expression` · `wind` · `blend` · `keyframes` | the motion intent; see Clip types |
| `speed` | number (≥0.05, ≤10) | cycle speed multiplier |
| `amplitude` | number (≥0, ≤4) | motion size multiplier |
| `duration` | number (≥0.1, ≤60) | seconds; default one natural cycle |
| `target` | string | part to drive for wave/nod/spin/attack/reach/point/pickup (default: auto) |
| `at` | [number, number, number] or string | reach/point/pickup/look: where, as a world point [x, y, z] in meters (the model stands on y=0 and faces +Z) or a part id (its center) |
| `lookAt` | [number, number, number] or string | keep the head turned to this point or part through the whole clip, on top of its own motion |
| `expression` | string | expression: the one to show (fades in, holds, fades out); blink/talk: the one to use (default: the blink / open_mouth expression) |
| `face` | { key: number (≥0, ≤1) } | hold expressions at these weights through the whole clip, e.g. { "smile": 1 } to walk smiling |
| `from` | string | blend: the clip to fade out of |
| `to` | string | blend: the clip to fade into; the blend ends where that clip starts, so play it next |
| `tracks` | Track[] | keyframes (type "keyframes") or layered on top of a procedural clip |
| `fps` | integer (≥4, ≤60) | sample rate for export (default 30) |
| `secondary` | boolean | springy follow-through on tails, ears and antennas, driven by how the body moves (default true) |

Clip types: `idle`, `walk`, `run`, `hop`, `fly`, `swim`, `drive`, `spin`, `hover`, `wave`, `nod`, `attack`, `jump`, `sit`, `turn`, `die`, `reach`, `point`, `pickup`, `look`, `blink`, `talk`, `expression`, `wind`, `blend`, `keyframes`.

### Track

| field | type | meaning |
|---|---|---|
| `part` **required** | string | part id (twins: "id.m") |
| `keys` **required** | Key[] | keys sorted by t; eased in and out |

### Key

| field | type | meaning |
|---|---|---|
| `t` **required** | number (≥0) | seconds |
| `rotation` | [number, number, number] | degrees around the part's pivot, world axes |
| `offset` | [number, number, number] | meters, added to rest position |

## Effect

| field | type | meaning |
|---|---|---|
| `id` **required** | string | effect id |
| `preset` | `fire` · `smoke` · `sparks` · `magic` · `explosion` · `dust` · `snow` · `rain` · `bubbles` · `heal` | starting parameters; every other field overrides it |
| `count` | integer (≥1, ≤4000) | particles alive at once (approx.) |
| `lifetime` | [number, number] | seconds [min, max] |
| `speed` | [number, number] | m/s [min, max] |
| `direction` | [number, number, number] | main emission direction (default up) |
| `spread` | number (≥0, ≤180) | cone half-angle in degrees |
| `gravity` | number (≥-50, ≤50) | m/s² along -Y (negative floats up) |
| `drag` | number (≥0, ≤10) | linear drag, 1/s |
| `size` | [number, number] | particle size in meters [start, end] |
| `colors` | string[] | color over life |
| `alpha` | [number, number] | opacity [start, end] |
| `emitter` | object | where particles are born: point, sphere, disc (flat, XZ) or box, with a size in meters |
| `blend` | `additive` · `alpha` | additive for glowing effects, alpha for smoke and dust |
| `burst` | boolean | emit everything at t=0 instead of continuously |
| `duration` | number (≥0.1, ≤10) | seconds baked |
| `frames` | integer (≥1, ≤64) | flipbook frames (default 16) |
| `tile` | integer (≥32, ≤512) | flipbook tile size in px |
| `seed` | integer (≥-9007199254740991, ≤9007199254740991) | change for a different but repeatable variation |
| `at` | Anchor or { point: [x, y, z] } | where it sits on the model (preview only) |

Presets: `fire`, `smoke`, `sparks`, `magic`, `explosion`, `dust`, `snow`, `rain`, `bubbles`, `heal`.
