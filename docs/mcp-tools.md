# MCP tools

The server speaks MCP over stdio (`clayform mcp`). Tools return text, and `render`,
`preview_motion` and `preview_effect` also return PNG images. Errors come back as tool errors
with the reason and a fix, never as a crash.

## Hosting over HTTP

`clayform serve` speaks MCP over streamable HTTP instead of stdio, for a server that several
agents or people use:

```bash
CLAYFORM_TOKEN=change-me clayform serve --port 8787
```

```bash
claude mcp add --transport http clayform http://127.0.0.1:8787/mcp --header "Authorization: Bearer change-me"
```

- **One workspace per session.** Each MCP session gets its own folder under
  `<workspace>/sessions/<id>` (default workspace `.clayform-hosted`), so sessions never see each
  other's scenes. The folder is removed when the client ends the session, or after `--idle`
  minutes without a request (default 30). `--keep` keeps the folders.
- **Paths stay inside it.** Every path a tool is given (export paths, `import_scene`, reference
  images, mesh sources and style sheets named in a scene, scene files named in a layout) is
  resolved inside the session's folder. Anything that points outside is refused with a message
  saying so, and an edit that would reach outside is taken back.
- **A token for anything public.** With `--token` (or `CLAYFORM_TOKEN`) every request needs
  `Authorization: Bearer <token>`. The server refuses to listen on a non-loopback address
  without one. On loopback it also checks the `Host` header, which blocks DNS-rebinding pages.
- **Limits.** At most `--max-sessions` sessions at once (default 16). Builds are CPU-heavy, so
  put a hosted server behind whatever rate limiting you already use.

## `guide`

`{ topic?: "manual" | "schema" }`. The agent manual, or the full JSON Schema. Read it once per session.

## `list_templates`

No arguments. One line per template: id, title, tags, what to change. See [templates](templates.md).

## `list_parts`

`{ query? }`. Search the [part library](parts.md). Add a part with the `add_library_part` edit op.

## `new_scene`

`{ name, template? }`. Creates a scene (id = a slug of the name) and returns a part summary
with resolved world positions plus the critics.

## `list_scenes` · `get_scene`

`get_scene { scene, format?: "summary" | "json" }`. The summary lists each part with shape, placement,
world center and size. `json` returns the document.

## `edit`

`{ scene, ops: Op[], render?: boolean }`. Applies ops in order, **all or nothing**. It returns what
changed and the critics, plus a three-quarter image when `render: true`.

| op | fields |
|---|---|
| `add_part` | `part`, `after?` (a part id, or `"start"`) |
| `add_library_part` | `name`, `id`, `attach`, `size?`, `mirror?`, `color?`, `after?` |
| `update_part` | `id`, `set` |
| `remove_part` | `id`, `cascade?` (also remove parts attached to it) |
| `rename_part` | `id`, `to` (references follow) |
| `duplicate_part` | `id`, `as`, `set?` |
| `add_sculpt` · `update_sculpt` · `remove_sculpt` | `sculpt` / `id`, `set` / `id` |
| `add_clip` · `update_clip` · `remove_clip` | `clip` / `id`, `set` / `id` |
| `add_effect` · `update_effect` · `remove_effect` | `effect` / `id`, `set` / `id` |
| `set_settings` | `set` |
| `set_palette` | `set` (a `null` value removes a color) |
| `set_meta` | `name?`, `notes?` |
| `replace` | `scene` (a whole document) |

`set` merges objects, replaces arrays, and `null` removes a field. Giving a new `shape.type`
replaces the shape.

<!-- verify: ops quadruped -->
```json
[
  { "op": "update_part", "id": "tail", "set": { "shape": { "radius": [0.05, 0.045, 0.03] } } },
  { "op": "duplicate_part", "id": "ear", "as": "ear_tuft", "set": { "shape": { "radii": [0.02, 0.05, 0.015] }, "attach": { "embed": 0.9 } } },
  { "op": "add_clip", "clip": { "id": "happy", "type": "hop", "speed": 1.4 } }
]
```

A failing batch returns, for example:

```
nothing was changed:
op 1 (remove_part): no part "ghost"
```

## `render`

`{ scene, views?, mode?, size? }`

- `views`: `front`, `back`, `left`, `right`, `top`, `bottom`, `three_quarter`,
  `three_quarter_back`, or `{ "yaw": deg, "pitch": deg }`. The default is front, left, top,
  three-quarter. Front, side and top views are orthographic (for proportions), and the
  three-quarter views are perspective.
- `mode`: `shaded` (default), `parts` (a color per part, with a legend in the image and in the
  text), `clay`, `normals`, `depth`.
- `size`: tile size in pixels, 128–768.

Add `compare: "previous"` to see the state before the last edit (top row) and now (bottom row)
with one camera. The text lists which parts were added, removed or changed.

## `compare_reference`

`{ scene, image, view? }`. Fits the model to a reference PNG seen from `view` (default
`front`): an IoU score, an overlay image, and sentences naming the parts that are too wide or
narrow. See [matching a reference](matching-a-reference.md).

## `measure`

`{ scene, queries: Query[] }`. Exact answers instead of judging from a picture. Meters, in the
grounded world the renders show.

| query | answers |
|---|---|
| `{ "between": ["hand", "leg"] }` | the surface-to-surface distance and closest points; a negative number is how deep they overlap. It is measured on the parts' own shapes, so it works for parts that blend together |
| `{ "part": "head" }` | size, center, bounds, and whether it touches the ground |
| `{ "ratio": ["head", "body"], "axis": "y" }` | size of one over the other along `x`, `y`, `z` or `max` |
| `{ "pixel": { "view": "front", "x": 190, "y": 60, "size": 384 } }` | which part is at that pixel of a `render` tile of that view and size |

Real output for the robot template, for the queries `[{"part":"head"}, {"ratio":["head","torso"],"axis":"x"}, {"between":["claw","leg"]}]`:

```
head: size 34.0 cm × 26.4 cm × 28.2 cm, center [0, 0.9475, 0.0009], from [-0.1702, 0.8157, -0.1401] to [0.1702, 1.0792, 0.1419]
head / torso along x: 0.7329 (34.0 cm / 46.4 cm)
claw to leg: 9.5 cm apart, closest points [0.2702, 0.3513, -0.0066] and [0.175, 0.3513, -0.0066]
```

## `inspect`

`{ scene }`. The part summary, [critics](critics.md), and a ground-contact check for every clip.

## `preview_motion`

`{ scene, clip, frames?, view? }`. A film strip of a clip (default 6 frames from the left)
with frame times, the joints that move, and the lowest point reached.

## `preview_effect`

`{ scene, effect }`. Up to 8 baked frames on a background that suits the blend mode.

## `export`

`{ scene, format?, path?, triangles?, effect?, bakeAo?, lods?, collision?, engine?, texture?, shading?, bands?, outline? }`.
See [levels of detail and collision](export.md#levels-of-detail-and-collision),
[textures](export.md#textures) and [flat, toon and outlines](export.md#flat-toon-and-outlines).

| format | writes |
|---|---|
| `glb` (default) | meshes, materials, vertex colors; a skin and animations when the scene has clips |
| `obj` | static geometry with vertex colors |
| `json` | the scene document |
| `flipbook` | an effect as a sprite sheet PNG plus a JSON of frames, fps and blend |

Triangles are reduced while keeping the shape within 0.4% of its size, or down to `triangles`
if given. See [export](export.md).

## `export_kit`

`{ scenes, dir?, atlas?, triangles?, embed?, shading?, bands?, outline?, collision?, engine? }`.
Separate GLBs that share one texture atlas, plus `atlas.png`. Returns the atlas image. See [kits](export.md#kits).

## `history`

`{ scene, action: "undo" | "redo" | "snapshot" | "restore" | "list", label? }`. Every `edit`
is one undo step. Snapshots are named and also saved to disk.

## `import_scene`

`{ path? , json?, name? }`. Loads a `.clay.json` into the workspace.
