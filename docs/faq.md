# FAQ

**Does it need Blender, a GPU or a browser?**
No. It is pure TypeScript on Node 20+. The renderer runs in software. Only the optional
`clayform view` page uses a browser (three.js).

**Is it better than Blender MCP?**
We have not measured that yet, so we don't claim it. [`bench/`](../bench/README.md) holds 20 fixed
prompts and a blind-judging protocol. Blender is far more capable as a general 3D package. Clayform
is built around what language models do badly: coordinates, seeing, and judging their own output.

**What does the output look like?**
Stylized and clay-like: smooth shapes, vertex colors, simple PBR factors. There are no UV
textures and no photoreal materials yet. Hard mechanical edges are rounded at the cell size.

**Can it make organic characters?**
Stylized ones, yes: smooth blends, swept tubes, anchored sculpts. Detailed organic sculpting
(wrinkles, anatomy) is not something it does. Handing that off to an image-to-3D model is on
the [roadmap](../ROADMAP.md).

**Which engines can use the exports?**
The GLB files are standard glTF 2.0 and pass the Khronos validator with zero errors. Skinned
animation has been checked in three.js. Godot, Unity (with a glTF importer) and Unreal import glTF,
but we have not tested them yet.

**Why do my thin parts disappear?**
They are thinner than about two cells at the current `settings.resolution`. The `too-small`
and `thin` critics tell you which ones. Raise the resolution or make the part `separate`.

**Why did my carve cut the wrong thing?**
A carve cuts every part listed *before* it. Move the parts that must stay whole after it.

**Why is the model standing on its door step?**
`ground: "auto"` puts the lowest point at y = 0. Raise the small part, or use `ground: "none"`.

**Where are my scenes?**
In `./.clayform/scenes/*.clay.json` (or `--workspace`). They are plain JSON, so keep them in git.

**Can I use it commercially?**
Yes. Apache-2.0. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
