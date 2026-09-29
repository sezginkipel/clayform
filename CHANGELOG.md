# Changelog

## 0.13.0 — 2026-09-29

Characters that act: standard bones for retargeting, reach and look, faces that blink and talk, cloth that moves.

- **Humanoid bone names** (#47): `skeleton: "humanoid" | "mixamo" | "unreal"` on export (and
  `--skeleton`) names a character's joints the way Unity Humanoid, Mixamo and Unreal's retargeter
  look for them. Parts are found by role and side. A spine, a forearm on a one-piece arm, a shin on
  a one-piece leg, and legs under a robe are added as bones with nothing bound to them, so the model
  moves as before. Rest positions are checked against the part-named export. Six templates map.
  Models that are not humanoid are refused with the bones that could not be placed.
- **Reach, point, pick up, look** (#48): new clip types. `at` is a world point or a part. An arm
  in two parts bends at the elbow (3D two-bone IK) and touches the point with its fingertip; a
  one-piece arm aims at it. `pickup` bends at the hip joints just far enough to reach the ground,
  feet planted. `look` turns the head and eyes, and `lookAt` holds a gaze through any clip.
- Planted feet now stay flat under any lean or turn above them, not only the leg's own swing.
- **Expressions** (#46): `expressions` are faces written as part changes and sculpts, with presets
  `blink`, `smile`, `frown`, `open_mouth` and `surprise`. They export as glTF morph targets
  (`extras.targetNames`). New clips `blink`, `talk` and `expression`, and `face` on any clip,
  animate their weights, and motion strips show them. Vertices ride with their part and settle onto
  the new surface, so untouched parts stay still and a mouth's color follows its corners. The
  critic warns when a blink closes eyes that are blended into the face.
- **`curve`** bends any part along its local X (a smile, an arched brow, a banana).
- **Cloth** (#49): `cloth: { pin?, wind?, amplitude?, wavelength? }` on a sheet (or any separate
  part) ripples it in every clip as a wave running from the pinned edge. It exports as four morph
  targets whose weights stay between 0 and 1, and loops fit whole waves. The new `wind` clip plays
  only that, and the flagpole template now uses it. Capes and cloth also swing behind the body on
  a spring. Blends carry face and cloth weights across.

## 0.12.0 — 2026-09-29

Materials and detail: surfaces an agent names instead of paints, and relief that costs no triangles.

- **Material presets** (#44): `material.preset: { kind, scale?, accent?, relief? }` with fourteen
  kinds: wood, planks, brick, stone, cobbles, tiles, metal, rust, fabric, leather, grass, bark,
  marble, sand. The colour becomes that material, with grooves shaded, per-brick and per-stone
  tone, and patterns that follow each face and move with the part. They show in the renders an
  agent looks at.
- **Normal and ORM maps** (#45): textured exports of parts with presets carry a tangent-space
  normal map baked from the relief, a metallic-roughness map (rust is rough and not metallic,
  tiles glossy and grout matte), and explicit `TANGENT`s built from each chart, so no engine has
  to guess the frame. The validator reports no errors or warnings. The test suite rebuilds the
  normal the way glTF defines it and checks it leans down the relief on faces pointing every way;
  flipping the encoding makes that test fail.
- Kits write `atlas_normal.png` and `atlas_orm.png` next to `atlas.png`.

## 0.11.0 — 2026-09-29

Shapes an agent can describe: the things Blender users model by hand, as a few numbers.

- **Lathe** (#37): a `[radius, height]` profile spun around Y, optionally `smooth`, faceted with
  `sides`, or as an open-topped wall with `shell` (cups, bowls, lamp shades, bells).
- **Extrude** (#38): a 2D outline pushed along Z with `rounding`, a `bevel` chamfer and a `taper`
  (signs, gears, keys, shields, panels).
- **Sheets** (#39): leaves, flags, sails, paper and cloth meshed directly, as thin as asked, with
  `bend` and `wave`. Closed (front, back, rim) and mirrored correctly.
- **Repeat and scatter** (#40): copies of a part and everything on it along a step, around a
  centre or in rows (window grids, columns, spokes), or spread over another part's surface with a
  gap, a size range and a seed (rocks and trees on terrain, spikes, leaves on a crown). Copies join
  the rig, so repeated legs walk.
- **Text** (#41): block letters for signs and labels.
- **Terrain** (#42): a heightfield ground tile of hills with height, roughness, scale and seed.
- **Kept meshes** (#43): `mesh { keep: true }` places a file's own triangles like a part (the
  example crate: 12 triangles instead of about 110,000 rebuilt from the grid).
- Four new templates use them: cup, sign post, flag pole and meadow tile (47 in all).
- Smooth profiles use centripetal Catmull-Rom, which never folds back on unevenly spaced points.

## 0.10.0 — 2026-09-29

Budgets that hold. Everything here came from building the 146 models of Cargo Century with Clayform.

- **One error for the whole model.** Simplification now measures error against the whole model's
  size and raises one shared error until the budget fits, instead of splitting the budget by raw
  triangle counts. A budget with room to spare gets a finer model than the default.
- **Sharp edges simplify.** Flat faces collapse across sharp edges when the error allows, so a
  tilted box reaches 12 triangles and a pyramid 6 (they used to stay near 90 and 180). Sharp
  meshes get exact face normals back afterwards. The cottage template now goes from 149,804 to
  2,116 triangles by default.
- **Nothing vanishes.** A part the error would prune away (a window, a bolt) is kept as its
  simplest shape. A budget that cannot be met without dropping parts is reported
  (`simplified.overBudget`, and a line in the export message).
- **Crisp colours at hard seams.** Two parts' colours mix only where their seam is blended, so
  paint does not bleed from a door onto a wall and painted parts no longer need to be `separate`.
- **`only` on carve and intersect** cuts just the parts it names (and their twins): a window
  through one wall of two, a roof clipped to its own box.
- On Cargo Century's 146 models with the game's own budgets: models more than 5% over budget went
  from 85 to 34 and the set from 29% to 15% over. Vehicles went from 51 over to 9; the other 25
  are houses with 52 to 125 separate parts and a 150-triangle budget.

## 0.9.0 — 2026-09-29

Part of the 1.0 work: the format is frozen, the tools can be hosted, and the docs have a site.

- **`clayform/1` is frozen.** Valid documents stay valid and build the same model in every later
  version. New optional fields can still be added; anything else bumps the format and ships a
  migration. `parseScene` walks old files up the migration chain and says what changed, a file
  from a newer Clayform is refused with a way forward, and `clayform migrate` writes the upgrade
  to disk. A frozen corpus of every template, the README goblin, the example layout and style
  must parse and build in every release. See docs/format.md. (#19)
- **MCP over HTTP.** `clayform serve` hosts the tools over streamable HTTP. Each session gets its
  own workspace folder, removed when the session ends or goes idle, and every path a tool is
  given (exports, imports, reference images, mesh sources, style sheets, layout scene files) must
  stay inside it, including inside build workers. A bearer token is required off loopback, and
  loopback checks the Host header. (#21)
- **Documentation site.** `site/` builds the docs from `docs/*.md` with SvelteKit for Cloudflare:
  the real renders, a contact sheet of every template, and a mark on each example the test suite
  checks. The build fails on any broken link or anchor, and CI runs it. (#20, not deployed yet)
- An edit whose scene no longer builds is now taken back instead of saved.

## 0.8.0 — 2026-09-29

- **Planted feet.** Walks and runs move each foot along the ground while it is down and swing
  it forward through the air. Legs with knees use two-bone IK. Rigid legs turn at the hip while
  the root drops just enough for the feet to reach, and the swinging leg tips outward to clear
  the ground. Boots and paws stay level. The walking speed is exported as the animation's
  `extras.speed`, and the motion critic follows the sole from touchdown to lift-off and reports
  sliding. On the templates' walks a foot moves at most 0.3 cm while it is down, except the baby
  dragon's right front foot at 1.1 cm. (#7)
- **Follow-through.** Tails, ears, antennas and hair trail behind the body on a damped spring,
  baked into the clip. Loops still loop. `secondary: false` turns it off. (#9)
- **Game actions.** `attack`, `jump`, `sit`, `turn` and `die`, built from roles so any model gets
  them, each with a film-strip test on the biped and the quadruped. `sit` and `die` keep the
  lowest point on the ground the whole way. (#10)
- **Blends.** A `blend` clip crossfades from one clip into another and ends exactly where the
  second one starts. The animation docs say how to blend the clips in Godot, Unity and Unreal
  (walk and run share a phase). (#8)
- The knight and the baby dragon have an attack. Their held sword and staff now ride on the
  hand, and a held item on a mirrored arm is no longer doubled.
- Fixes: leg angles near straight-down no longer flip the quaternion sign between frames, and
  sampled rotations stay in one hemisphere so engines never interpolate the long way round.

## 0.7.0 — 2026-09-29

- **Baked textures.** `texture: 1024` (CLI `--texture 1024`) unwraps the model into charts that
  each face one axis, packs them into one atlas, and paints every texel from the parts at that
  point. Patterns come out sharper than vertex colors, and engines whose default materials
  ignore vertex colors show the real colors. The GLB gets `TEXCOORD_0` and an embedded PNG. (#16)
- **Kits.** `export_kit` / `clayform kit a b c -o kit` writes separate GLBs that all point at one
  shared `atlas.png`, so an engine loads one texture for the whole set. `embed` puts a copy in
  each file instead. (#17)
- **Flat and toon shading, outlines.** `shading: "flat"` gives faceted low-poly normals.
  `shading: "toon"` bakes the light into `bands` steps and marks the materials unlit.
  `outline: 0.01` adds an inverted-hull rim that follows the skin. (#18)
- The test suite checks that the atlas color at every vertex's UV matches the vertex color, that
  gutters are filled, that kit models never share a texel, and that every combination passes the
  Khronos validator with no errors or warnings. The toon, outlined and textured walk was checked
  playing in three.js.

## 0.6.0 — 2026-09-28

- **Style sheets.** A `clayform-style/1` file holds a pack's palette, material defaults, resolution,
  edge style and height range per category. Scenes point at it with `style`, and critics flag colors
  outside the palette, local overrides and models outside their category's height range. (#31)
- **Part library.** 28 ready parts (eyes, ears, horns, wings, wheels, doors, hats …) placed with one
  `add_library_part` edit and searched with `list_parts`. See docs/parts.md. (#12)
- **Layouts.** A `clayform-layout/1` file places many scenes by hand or by pattern (row, grid,
  circle, scatter with a minimum gap). `set_layout`, `render_layout` and `export_layout` build it
  into one GLB, and the layout critic flags items that overlap or float. (#11)
- **LODs and colliders.** `--lods 0.5,0.2` adds lower-detail meshes, `--collision parts|hull` adds
  convex hulls (at most 255 vertices each), and `--engine godot|unreal|unity` names them so the
  engine picks them up on import. (#14)
- **Parallel builds.** Large scenes are sampled, meshed and shaded on worker threads, with the same
  output as a serial build. The cottage at resolution 160 builds in 1.3 s instead of 3.2 s.
  Blocks far from any surface are skipped, which speeds up serial builds too.
  `CLAYFORM_WORKERS=0` turns the workers off. (#5)
- **43 templates.** 24 new ones: knight, wizard, cat, frog, penguin, teddy bear, ghost, baby dragon,
  chicken, pickup truck, propeller plane, sailboat, rocket, castle tower, well, lamp post, tent,
  pine, potted cactus, campfire, table, chair, round shield and lantern. All of them pass the
  critics and their clips pass the motion check. (#13)
- Rotors spin around their thinnest axis, so a propeller facing forward turns around Z.
- The fused-parts critic no longer flags a part that rides on its ancestor (a hat brim and the
  head under it).

The per-engine import guides (#15) moved to v1.0: they need Godot, Unity and Unreal installed to be
tested, and an untested guide is not worth shipping.

## 0.5.0 — 2026-09-28

- **Colors that blend together.** Touching parts whose colors are meant to differ but are too close
  to tell apart (ΔE under 10 and contrast under 1.35:1) are flagged with a lighter or darker
  suggestion. Parts given the same base color on purpose are left alone. (#27)
- **Details too small for the game camera.** Set `settings.screenHeight` to how tall the model is
  on screen, and parts that cover fewer than 4 pixels at that size are named. (#28)
- **Same silhouette from every side.** Creatures whose front and side silhouettes overlap by more
  than 93% get a warning with ideas for side-view depth. Round props get a note instead. (#29)
- Updated to TypeScript 7, Vitest 5 and the current CI actions.

## 0.4.0 — 2026-09-28

- **`compare_reference`** fits the model to a sketch or photo seen from one side. The reference is
  registered onto the model by the scale and shift that overlap them best, so a change to one part
  stays at that part. It returns an IoU score, an overlay (orange = only in the reference, blue =
  only in the model) and sentences that name the parts that are too wide or narrow. (#25, #26)
- Reference backgrounds are found by a flood fill from the border, so light areas inside the object
  still count as the object.
- `clayform compare <scene> <reference.png>` does the same from the command line.
- A PNG decoder (8-bit gray, RGB, RGBA and palette images).

## 0.3.0 — 2026-09-28

- **Sharp edges.** `settings.edges: "sharp"` places vertices by dual contouring, so box corners land
  on the corner (0.05 cells away instead of 1.15) and normals split where faces meet steeply. The
  house, chest, sword, robot and crystal templates use it. (#22)
- **`measure` tool.** Surface distance between parts (negative when they overlap, even when
  they blend together), part size and bounds, ratios, and which part is at a pixel of a render. (#23)
- **`render { compare: "previous" }`** shows the state before the last edit above the current one,
  with one camera, and lists what changed. (#24)

## 0.2.0 — 2026-09-28

- **Imported meshes as parts.** A `mesh` shape loads a `.glb` or `.obj`, bakes it into a distance
  grid and from then on it attaches, blends, carves, mirrors and goes through the critics like
  any other part. Open meshes are kept as a thin shell, with a warning. (#2)
- **Clips are checked for parts passing through each other.** `inspect` and `preview_motion` say
  which parts collide, when, and how deep. Overlaps that already exist at rest are ignored. (#4)
- **`clayform view --watch`** reloads the viewer when the scene file changes, keeps the last good
  version when an edit is invalid, and shows the error. (#6)
- Palette errors now say what a valid name and color look like.
- Docs: getting started, concepts, MCP tools, critics, animation, effects, export, CLI and library,
  architecture, FAQ. The scene reference, template catalog and `schema/clayform.schema.json` are
  generated from the code, and every docs example marked `verify` runs in the test suite.
- Every scene field has a description, both in the JSON Schema and in what agents read.

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
