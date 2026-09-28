# Critics

Pictures hide things. Critics measure them. They run after every `edit`, in `render` and
`inspect`, and on the CLI (`clayform inspect` exits with code 2 when there are errors). Each issue
has a severity, a code, the parts involved and what to do. Every critic has a test that builds
the defect on purpose and checks that it is caught.

| code | severity | what it means | usual fix |
|---|---|---|---|
| `floating` | error | a piece of the body is not connected to the rest | `attach` it, raise `embed`, or mark it `separate` |
| `floating` (split) | error | a part was cut into separate pieces, usually by a carve | list parts that must stay whole *after* the carve, shrink the carve, or add `blend` |
| `buried` | error | a part is entirely inside others, so nothing of it shows | move it out, lower `embed`, or remove it |
| `too-small` | error | a part is thinner than two cells and vanished | raise `settings.resolution` or make it `separate` |
| `thin` | warn | a part is under 2.5 cells thick and will look lumpy | the same |
| `separate-gap` | warn | a separate part touches neither the body nor another separate part nor the ground | attach it or lower `embed` |
| `asymmetric` | warn | declared X symmetry is broken, overall or on a single part | use `mirror: true` instead of placing both sides by hand |
| `tips-over` | warn | the center of mass is outside the ground-contact footprint. The message lists what touches the ground | if a small part hangs below the base, raise it; otherwise widen the base |
| `over-budget` | warn | the working mesh exceeds `settings.budget`. The message suggests a resolution | lower resolution, or rely on export's `triangles` |
| `fused-unrelated` | warn | two parts that move on their own touch and fuse (a hand against a leg), so the bridge will stretch in animation | move them apart by more than their blend radius, or make one separate |
| `colors-blend` | warn | two touching parts have different colors that are too close to tell apart (ΔE under 10 and contrast under 1.35:1), so they read as one blob. Parts given the same base color on purpose are left alone | use the suggested lighter or darker color, or make them the same on purpose |
| `tiny-detail` | warn | with `settings.screenHeight`, a part covers fewer than 4 pixels (or vanishes) when the model is that tall on screen | make it bigger or bolder, or drop it and save the triangles |
| `same-silhouette` | warn / info | the front and side silhouettes overlap by more than 93%, so the model reads the same as it turns. A warning for things with legs, tails or wings, a note for props | add depth seen from the side: a snout, a tail, a backpack, feet that point forward |
| `off-style-color` | warn | a part uses a hex color that is not in the scene's style palette | use a palette key |
| `style-override` | warn | the scene palette redefines a color the style already defines | remove it from the scene, or change the style for the whole pack |
| `off-style-scale` | warn | the model's height is outside the style's range for its `category` | scale it to match the pack |
| `placement` | warn | an attach offset landed outside the target's outline and was snapped to the surface | use a smaller offset |
| `speck` | info | a tiny loose fragment where two surfaces almost touch | add `blend` or `embed` |
| `open-edges` | info | more than 0.2% of edges are non-manifold | harmless for games; raise resolution for 3D printing |
| `above-ground` / `below-ground` | info | with `ground: "none"`, how far the model is from y = 0 | informational |

Clip checks (in `inspect` and `preview_motion`):

- **pass through each other**: during the clip, two parts that are not joined (a hand and the
  body, an arm and a leg) overlap more than 1.5 cells, when they did not overlap at rest. The message
  gives the time and the depth. Lower the amplitude, move the pivot, or angle the part away.
- **sinks below the ground**: a clip pushes the mesh under y = 0. Lower `amplitude` or shorten the limbs.
- **never touches the ground**: a walk-like clip that never makes contact.
- **no parts move**: give parts roles (`leg`, `arm`, `tail`, `wing`, `wheel`, `rotor`, `head`, `ear`) or add keyframe tracks.

## Reading a report

```
size 1.00 × 1.32 × 0.46 m · 31,412 triangles · 2 body islands · built in 226 ms
ERROR [floating] orb is not connected to the rest of the body — use attach, raise embed, or mark it separate if it should be its own mesh
WARN [asymmetric] declared X symmetry is off by 1.3 cm on average; worst: orb (43.1 cm) — use mirror: true instead of hand-placing both sides
```

The first line gives the overall size in meters (x × y × z), triangles at working resolution,
connected pieces of the fused body (1 is what you want), and build time.
