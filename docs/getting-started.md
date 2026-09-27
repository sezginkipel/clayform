# Getting started

## 1. Install

You need Node 20 or newer. Clayform installs from GitHub and builds itself.

```bash
claude mcp add clayform -- npx -y github:sezginkipel/clayform mcp
```

Other MCP clients (Cursor, Claude Desktop, …) take the same command:
`npx -y github:sezginkipel/clayform mcp`. For a fixed version, install the tarball from
[Releases](https://github.com/sezginkipel/clayform/releases).

Scenes are saved as `.clay.json` files in `./.clayform/scenes/`, and exports go to
`./.clayform/exports/`. To use another folder, pass `--workspace <dir>` or set `CLAYFORM_WORKSPACE`.

## 2. Ask for something

Talk to your agent the way you would talk to a modeler:

> Make a goblin from the biped template: green skin, pointy ears, no hair, a pointed nose.
> Check it from the front and the side, then export it with a walk cycle.

A good agent will call `guide` once, then `list_templates`, `new_scene`, `render`, then `edit`
in batches, reading the critics after each edit.

## 3. What the agent is doing

It starts from a template:

```json
{ "name": "Goblin", "template": "biped" }
```

It edits in one atomic batch. If any op fails, nothing changes and the error names the op:

<!-- verify: ops biped -->
```json
[
  { "op": "set_palette", "set": { "skin": "#7fb04a", "shirt": "#6b4a2b", "pants": "#3d3322" } },
  { "op": "update_part", "id": "hair", "set": { "hidden": true } },
  { "op": "add_part", "part": {
      "id": "ear", "role": "ear", "shape": { "type": "cone", "height": 0.16, "radius": 0.045 },
      "attach": { "to": "head", "side": "left", "offset": [0, 0.2], "align": true, "embed": 0.2 },
      "rotation": [0, 0, -25], "mirror": true, "blend": 0.02, "material": { "color": "skin" } } },
  { "op": "update_part", "id": "nose", "set": {
      "shape": { "type": "cone", "height": 0.09, "radius": 0.03 },
      "attach": { "to": "head", "side": "front", "offset": [0, -0.1], "align": true, "embed": 0.2 } } }
]
```

It looks at the result (`render`), with each part in its own color when it needs to know what is what:

| shaded | `mode: "parts"` |
|---|---|
| ![](goblin.png) | ![](goblin-parts.png) |

Then it exports. The template already has `walk` and `idle` clips.

```json
{ "scene": "goblin", "format": "glb", "triangles": 3000 }
```

## 4. Look at it yourself

```bash
npx -y github:sezginkipel/clayform view .clayform/exports/goblin.glb
```

This opens a local page (`http://127.0.0.1:5231/`) that shows the model in three.js and
plays its clips.

## 5. Without an agent

```bash
npx -y github:sezginkipel/clayform new quadruped -o dog.clay.json
# edit dog.clay.json by hand, then:
npx -y github:sezginkipel/clayform render dog.clay.json --mode parts
npx -y github:sezginkipel/clayform inspect dog.clay.json
npx -y github:sezginkipel/clayform export dog.clay.json -o dog.glb --triangles 4000
```

Next: [Concepts](concepts.md).
