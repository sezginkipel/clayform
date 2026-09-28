# Animation

## The rig builds itself

When a scene has clips, every part becomes a joint at its **pivot**, under a `root` joint on the
ground. The hierarchy follows `attach` and `parent`. Skin weights stay on a vertex's own part and
its parent and children, so a hand that rests near a hip never follows the leg.

Rest rotations are identity, so a joint rotation means "turn this part about its pivot, in world
axes". A leg swing is `rotation: [30, 0, 0]`.

### Pivots

- By default the pivot is where the part attaches. Otherwise it is the top of a `leg` or `arm`,
  the bottom of a `head` or `neck`, and the center of anything else.
- Override with `pivot`: `center`, `top`, `bottom`, `front`, `back`, `left`, `right`,
  `attach`, or a local `[x, y, z]`.

### Roles drive the motion

| role | walk / run | idle | hop | fly | swim | drive / hover |
|---|---|---|---|---|---|---|
| `leg` | swings by gait; lower segments bend | still | tucks | tucks back | — | — |
| `arm` | counter-swings its side's leg | sways | lifts | — | paddles | — |
| `head` | nods and turns a little | looks around | — | — | counter-turns | — |
| `tail` | sways | sways | flicks | trails | beats | — |
| `wing` | small flap | settles | — | flaps | fin strokes | — |
| `ear` | bounces | twitches | flops | — | — | — |
| `wheel` | rolls | — | — | — | — | rolls (drive) |
| `rotor` | — | slow spin | — | spins | — | spins |

Gait comes from the legs: two legs alternate, four legs trot diagonally, and six or more move
in alternating tripods.

## Clip types

`idle`, `walk`, `run`, `hop` (with squash and stretch), `fly`, `swim`, `drive`, `spin` (the
`target` or the whole model), `hover`, `wave` (the `target` arm, or the one on the model's right),
`nod`, `keyframes`.

`speed` multiplies the cycle rate, `amplitude` the motion size, `duration` sets the length (the
default is one natural cycle, so clips loop), and `fps` the export sample rate.

<!-- verify: clip biped -->
```json
{ "id": "wave_hello", "type": "wave", "target": "arm", "amplitude": 1.2 }
```

## Keyframes

Tracks turn and offset parts about their pivots, eased in and out, and layer on top of a procedural
clip (or stand alone with `type: "keyframes"`):

<!-- verify: clip biped -->
```json
{ "id": "look_back", "type": "keyframes", "duration": 2,
  "tracks": [
    { "part": "head", "keys": [ { "t": 0, "rotation": [0, 0, 0] }, { "t": 1, "rotation": [0, 70, 0] }, { "t": 2, "rotation": [0, 0, 0] } ] },
    { "part": "arm.m", "keys": [ { "t": 0, "rotation": [0, 0, 0] }, { "t": 1, "rotation": [0, 0, -40] }, { "t": 2, "rotation": [0, 0, 0] } ] }
  ] }
```

Mirror twins are addressed as `<id>.m`.

## Checking motion

`preview_motion` renders frames from one camera framed on the whole clip, so movement reads as
movement. `inspect` samples every clip and reports parts passing through each other, sinking
below the ground, never touching it, or not moving at all. The `fused-unrelated` critic warns
*before* you animate when two moving parts are fused.

## Limits

No IK, physics or retargeting yet. Limbs are rigid segments that bend at joints. A walk cycle does
not plant its feet on uneven ground. See the [roadmap](../ROADMAP.md).
