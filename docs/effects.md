# Effects

An effect is a particle emitter baked into a **flipbook**: a sprite sheet PNG plus a JSON
file that says how to play it. Particles follow a closed-form path (linear drag plus gravity), so
a looping effect repeats exactly, and the same seed always produces the same frames.

![Eight frames of the fire preset](fire.png)

## Presets

| preset | blend | loops | good for |
|---|---|---|---|
| `fire` | additive | yes | torches, campfires, burning props |
| `smoke` | alpha | yes | chimneys, exhausts, after explosions |
| `sparks` | additive | yes | grinding, hits, electric faults (streaked) |
| `magic` | additive | yes | auras, pickups, spells |
| `explosion` | additive | no (burst) | impacts, destruction |
| `dust` | alpha | yes | footsteps, landings, skids |
| `snow` | alpha | yes | weather tiles |
| `rain` | alpha | yes | weather tiles (streaked) |
| `bubbles` | alpha | yes | potions, underwater |
| `heal` | additive | yes | buffs, healing |

## Parameters

Every field overrides the preset: `count` (particles alive at once), `lifetime`, `speed`
(`[min, max]`), `direction`, `spread` (cone half-angle in degrees), `gravity` (m/s², negative
floats up), `drag`, `size` and `alpha` (`[start, end]`), `colors` (a gradient over life),
`emitter` (`point`, `sphere`, `disc`, `box`, with a size), `blend`, `burst`, `duration`,
`frames`, `tile` (px), `seed`.

<!-- verify: effect torch -->
```json
{ "id": "green_flame", "preset": "fire", "colors": ["#eaffd0", "#7be35a", "#1f8a3a"], "count": 90, "spread": 10 }
```

## Output

`export { format: "flipbook", effect: "flame" }` on the torch template writes `<name>.png` and this `<name>.json`:

```json
{ "effect": "flame", "frames": 16, "columns": 4, "rows": 4, "tile": 128, "fps": 16,
  "duration": 1, "loop": true, "blend": "additive", "metersPerTile": 1.1078, "pivot": [0.4988, 0.8867] }
```

- Frames go left to right, then top to bottom.
- `metersPerTile` is the world size one tile covers, so the billboard can be scaled to match the model.
- `pivot` is the emitter origin in tile UV (0..1, from the top left). Anchor the billboard there.
- Additive sheets keep premultiplied color. Alpha sheets are straight alpha.

The effect's `at` places it on the model for previews. Engines attach the billboard to the
matching node themselves.
