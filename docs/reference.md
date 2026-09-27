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
| `settings` | object | see Settings |
| `parts` **required** | object[] | in blend order: blend and carve act on the parts listed before them |
| `sculpts` | object[] | applied in order after all parts |
| `clips` | object[] | animations; the rig is built automatically |
| `effects` | object[] | particle effects baked to flipbooks |

## Settings

| field | type | meaning |
|---|---|---|
| `resolution` | integer (≥16, ≤256) | cells along the longest axis (detail vs. triangles), default 96 |
| `ground` | `auto` · `none` | auto lifts/drops the model so it stands on y=0 (default) |
| `symmetry` | `x` · `none` | declare mirror symmetry so critics check it |
| `budget` | integer (≥100, ≤2000000) | triangle budget for critics |
| `ao` | boolean | compute ambient occlusion into vertex shading (default true) |
| `rig` | `auto` · `none` | auto: skeleton from parts when clips exist |

## Part

| field | type | meaning |
|---|---|---|
| `id` **required** | string | unique snake_case id; a mirror twin is id + ".m" (exported to glTF as id_mirror) |
| `role` | string | semantic role used by animation and critics: body, head, leg, arm, tail, wing, wheel, rotor, eye, ear, horn, prop … |
| `label` | string | free text for people |
| `shape` **required** | one of `sphere`, `ellipsoid`, `box`, `capsule`, `cylinder`, `cone`, `torus`, `prism`, `tube` | see Shapes |
| `position` | [number, number, number] | relative to parent; with attach it is an extra world offset |
| `rotation` | [number, number, number] | Euler degrees XYZ |
| `scale` | number (>0) or [number (>0), number (>0), number (>0)] | uniform or per local axis; the easy way to stretch a template part |
| `parent` | string | position/rotation are relative to this part and follow its rotation (ignored when attach is set) |
| `attach` | Anchor | place on another part's surface; the part keeps its own rotation (use align to point it along the surface normal) |
| `op` | `add` · `carve` · `intersect` | add (default) merges, carve cuts away, intersect keeps only the overlap |
| `blend` | number (≥0, ≤1) | smooth merge radius in meters with everything before it; 0 = hard seam |
| `material` | object | see Material |
| `pattern` | object | see Pattern |
| `detail` | object | see Detail |
| `mirror` | boolean | add a mirrored twin across X (id + ".m") |
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
| `type` **required** | `idle` · `walk` · `run` · `hop` · `fly` · `swim` · `drive` · `spin` · `hover` · `wave` · `nod` · `keyframes` | the motion intent; see Clip types |
| `speed` | number (≥0.05, ≤10) | cycle speed multiplier |
| `amplitude` | number (≥0, ≤4) | motion size multiplier |
| `duration` | number (≥0.1, ≤60) | seconds; default one natural cycle |
| `target` | string | part to drive for wave/nod/spin (default: auto) |
| `tracks` | Track[] | keyframes (type "keyframes") or layered on top of a procedural clip |
| `fps` | integer (≥4, ≤60) | sample rate for export (default 30) |

Clip types: `idle`, `walk`, `run`, `hop`, `fly`, `swim`, `drive`, `spin`, `hover`, `wave`, `nod`, `keyframes`.

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
