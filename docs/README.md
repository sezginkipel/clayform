# Clayform documentation

Clayform is a 3D workshop for AI agents: they edit a scene document, and Clayform meshes it,
renders it for them to look at, measures it with critics, rigs and animates it, bakes effects
and exports glTF.

| Read this | When you want to |
|---|---|
| [Getting started](getting-started.md) | install it, connect an agent, make a first model |
| [Concepts](concepts.md) | understand placement, blending, carving, mirroring and why the order of parts matters |
| [MCP tools](mcp-tools.md) | see every tool, its arguments and what it returns |
| [Critics](critics.md) | know what each critic code means and how to fix it |
| [Matching a reference](matching-a-reference.md) | move a model toward a sketch or photo with a score and directions |
| [Animation](animation.md) | rig, clips, pivots, keyframes, motion checks |
| [Effects](effects.md) | particle presets, parameters, flipbook output |
| [Export](export.md) | glTF structure, triangle budgets, naming, engines |
| [CLI and library](cli-and-library.md) | use Clayform without an agent |
| [Architecture](architecture.md) | how it works inside, and where to change things |
| [FAQ](faq.md) | common questions and honest limits |
| [Scene reference](reference.md) | every field (generated from the schema) |
| [Templates](templates.md) | the starting points, with renders |
| [Part library](parts.md) | reusable eyes, ears, noses, horns, tails, wings, limbs, wheels, windows, doors, hats … |

The same manual the agent reads is in [`src/guide.ts`](../src/guide.ts) (the `guide` tool).
The JSON Schema for scene files is [`schema/clayform.schema.json`](../schema/clayform.schema.json).

Every JSON example in these pages marked `verify` is checked by the test suite, so the
examples keep working as the code changes.
