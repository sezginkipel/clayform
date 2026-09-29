# Concepts

## The scene document

A scene is plain JSON: a list of **parts**, then **sculpts**, **clips** and **effects**, with
**settings** and a **palette**. The agent never touches vertices. Everything else, like the mesh,
colors, skeleton, animation samples and flipbooks, is derived from the document every time.

Conventions: meters, +Y up, the model faces **+Z**, the model's own **left is +X**, rotations are
Euler degrees applied X → Y → Z. Full field list: [reference](reference.md).

## Placing parts

A part is placed in one of three ways:

1. **`attach`**: on another part's surface. This is the normal way, and it is why things don't float.
2. **`parent`**: relative to another part, following its rotation (hierarchies, hinged lids).
3. Neither: `position` is in world space.

### Attach

<!-- verify: part biped -->
```json
{ "id": "horn", "shape": { "type": "cone", "height": 0.14, "radius": 0.035 },
  "attach": { "to": "hair", "side": "top", "offset": [0.4, 0.1], "align": true, "embed": 0.25 },
  "mirror": true, "material": { "color": "#e8dcc0" } }
```

In the biped template the hair covers the top of the head, so horns attach to `hair`. Attached
to `head` they would sit under the hair, and the `buried` critic says so.

- **`side`** is a *world* direction you look at the target from: `top` (+Y), `bottom`, `front`
  (+Z), `back`, `left` (+X, the model's left), `right`, or `center`. It does not depend on how the
  target is rotated.
- Without `offset`, Clayform picks the **extreme point** in that direction. The bottom of a
  tilted arm is its tip, not a point on its side.
- **`offset: [u, v]`** slides across that side by −1…1 of the target's half size (world axes:
  top/bottom `[x, z]`, front/back `[x, y]`, left/right `[z, y]`).
- **`embed`**: 0 = just touching, 0.35 = default, 1 = the part's center sits on the surface,
  negative = a gap. It is measured along the surface normal against the part's own extent.
- **`align: true`** turns the part so its local +Y points out of the surface. Use it for horns,
  spikes, noses and legs.
- An attached part keeps **its own rotation** (it does not inherit the target's). `position` then
  adds a world-space nudge. In short, *attach places, parent carries*.

## Blending, carving and order

All non-separate parts fuse into one smooth body (a signed distance field). **The order of
`parts` matters.** Each part combines with everything listed *before* it:

- `op: "add"` (default) with `blend` = smooth-merge radius in meters (0 = a hard seam).
  Colors follow the seam: across a hard seam each part keeps its own color with a crisp line,
  so a painted door or a company stripe can stay fused to the body instead of being `separate`;
  across a blended seam the colors blend too.
- `op: "carve"` cuts itself out of the parts listed before it. Parts listed after it are not cut.
  To hollow a mushroom cap without cutting its stem, list the stem after the carve.
- `op: "intersect"` keeps only the overlap. The barrel template trims an ellipsoid flat this way.
- `only` limits a carve or an intersect to the parts it names (and their mirror twins), wherever
  they are in the list: a window through one wall of two, or a roof clipped to its own box
  without cutting the chimney next to it.

A carve with a `material.color` paints the cavity it makes (windows, mouths, doors). This
gives the slime template an open mouth, and `after` puts the carve right after the body so the
eyes listed later stay whole:

<!-- verify: ops slime -->
```json
[
  { "op": "remove_sculpt", "id": "mouth" },
  { "op": "add_part", "after": "puddle", "part": {
      "id": "mouth", "shape": { "type": "ellipsoid", "radii": [0.09, 0.035, 0.06] },
      "attach": { "to": "blob", "side": "front", "offset": [0, -0.2], "embed": 0.7 },
      "op": "carve", "blend": 0.015, "material": { "color": "#3b1f2b" } } }
]
```

## Mirror

`mirror: true` adds an exact reflection across X, with the id `<id>.m` in the scene and
`<id>_mirror` in glTF. Parts attached to a mirrored part are mirrored too, so a mirrored arm
brings its hand. Set `mirror: false` on the child to stop that. Declare
`settings.symmetry: "x"` and the critics will measure how symmetric the result is.

## Separate parts

`separate: true` meshes a part on its own instead of fusing it: wheels that spin, rotors, a sword
in a hand, a hubcap on a wheel. Separate parts still attach, animate and export (as their own
glTF meshes).

## Imported meshes

A `mesh` shape brings in a `.glb` or `.obj` (from another tool, a scan, or an image-to-3D
model). It is baked once into a distance grid, so from then on it is a part like any other:
things attach to it, it blends and carves, it mirrors, and the critics check it.

<!-- verify: part biped -->
```json
{ "id": "crate", "shape": { "type": "mesh", "src": "docs/examples/crate.obj", "size": 0.3 },
  "attach": { "to": "hand", "side": "bottom", "embed": 0.2 }, "separate": true,
  "material": { "color": "#9a7b5a" } }
```

- `src` is an absolute path, or relative to where the server runs (or the workspace).
- `size` scales the longest axis to that many meters. The mesh is centered on its bounding box.
- `resolution` sets the distance grid (default 64 cells on the longest axis). Raise it for fine detail.
- Geometry only: the color comes from `material`, and textures and vertex colors in the file are ignored.
- An open mesh (with holes) is kept as a thin shell, and a `placement` warning says so.
- Compressed glTF (Draco, meshopt, quantization) is refused with a message. Export without compression.

## Surface: materials, patterns, detail

- `material`: `color` (hex or palette key), `roughness`, `metalness`, `emissive`, `emissiveStrength`.
- `pattern`: `spots`, `stripes`, `noise` or `gradient` in a second color, on the part's local
  `axis` (`around` gives vertical staves).
- `detail`: bumpy displacement (`amount`, `scale` in meters) for rock, bark and foliage.
- `palette`: named colors. Recolor a whole model by changing one entry.

## Sculpting

Sculpts are applied after all parts, in order, anchored like attachments:

<!-- verify: sculpt biped -->
```json
{ "id": "cheeks", "kind": "inflate", "at": { "to": "head", "side": "front", "offset": [0.45, -0.25] },
  "radius": 0.06, "amount": 0.012, "mirror": true }
```

| kind | does | `amount` is |
|---|---|---|
| `inflate` / `dent` | push the surface out / in with a smooth falloff | meters of push |
| `flatten` | cut a plane (from the surface normal or `normal`) | meters cut |
| `crease` | cut a groove from `at` to `to`, `radius` wide | groove depth |
| `noise` | roughen locally, or everywhere without `at` | meters |

## Style sheets for a pack

Ten assets made one at a time drift apart: different scales, palettes, bevels. A style sheet
(`.style.json`) holds what a pack shares, and each scene points at it:

<!-- verify: ops barrel -->
```json
[{ "op": "set_meta", "style": "docs/examples/toybox.style.json", "category": "prop" }]
```

- The style's **palette** sits under the scene's own, so parts can use its keys. Change a color in
  the style and every scene that uses it changes.
- **defaults** (blend, rounding for boxes, cylinders, cones and prisms, roughness, metalness) fill
  in whatever a part leaves unset. **settings** do the same for scene settings.
- **heights** give each category an allowed height range.

Critics then flag drift: a hex color that is not in the style palette (`off-style-color`), a
scene that redefines a style color (`style-override`), and a model outside its category's
height range (`off-style-scale`). See [`docs/examples/toybox.style.json`](examples/toybox.style.json).

## Sharp or soft edges

By default edges are rounded to the cell size, which suits creatures and clay-like props. Set
`settings.edges: "sharp"` for hard-surface models: vertices are placed by dual contouring, so they
land on real edges and corners, and normals are split where faces meet steeply, so the edges also
shade as edges. The house, chest, sword, robot and crystal templates use it.

Details smaller than about two cells (a band that stands out 5 mm on a 1 m chest at
resolution 120) can look serrated in sharp mode. Make them stand out a little more, or raise the
resolution.

## Resolution and triangles

`settings.resolution` is the number of cells along the longest axis (default 96). Parts thinner
than about two cells vanish or look lumpy, and the `thin` and `too-small` critics say so. More
resolution means more triangles *while working*. Export reduces them to a budget, so working
resolution and game triangle count are separate decisions.

## Ground

With `settings.ground: "auto"` (default) the finished model is moved so its lowest point is at
y = 0. If a small part hangs lower than the base (a door step, a pebble), the whole model ends
up standing on it, and the `tips-over` critic points that out. Use `ground: "none"` for
things that float (fish, spaceships in flight).

Next: [MCP tools](mcp-tools.md) · [Critics](critics.md).
