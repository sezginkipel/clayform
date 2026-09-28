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
| `leg` | steps with planted feet (IK) | still | tucks | tucks back | — | — |
| `arm` | counter-swings its side's leg | sways | lifts | — | paddles | — |
| `head` | nods and turns a little | looks around | — | — | counter-turns | — |
| `tail` | sways | sways | flicks | trails | beats | — |
| `wing` | small flap | settles | — | flaps | fin strokes | — |
| `ear` | bounces | twitches | flops | — | — | — |
| `wheel` | rolls | — | — | — | — | rolls (drive) |
| `rotor` | — | slow spin | — | spins | — | spins |

Gait comes from the legs: two legs alternate, four legs trot diagonally, and six or more move
in alternating tripods.

### Planted feet

`walk` and `run` plant the feet. Each foot slides back along the ground while it is down
(60% of a walk cycle, 38% of a run, so a run has short flights) and swings forward through the
air. The legs are solved to those targets:

- A leg with a knee (a `leg` part whose child is also a `leg`) uses two-bone IK. The knee bends
  the way it bends at rest, or forward when the leg is straight.
- A rigid leg turns at the hip. The root drops just enough for the stance feet to reach the
  ground, the steps stay short enough that the drop is under a cell, and the swinging leg tips
  outward a little to clear the ground.
- Parts on the bottom of a leg (a boot or a paw) stay level, so the sole does not rock.

The feet move back at the clip's speed, which is exported as the animation's `extras.speed`
(m/s). Move the character at that speed and the feet stay put in the world. A leg is planted
only if it hangs down from its hip and reaches the ground at rest. Flat flipper-feet and legs
in a sitting pose keep the simple swing.

Measured on the templates' walks (biped, robot, knight, quadruped, cat, chicken, baby dragon):
a foot moves at most 0.3 cm between touchdown and lift-off, except the baby dragon's right front
foot at 1.1 cm. A cell is 0.4–1.1 cm on those models.

### Follow-through

Tails, ears, antennas and hair (`tail`, `ear`, `antenna`, `hair` roles) get secondary motion on
top of their own sway. The tip of each is a point on a damped spring that chases where the tip
would be if the part were rigid: when the body turns, the tail trails, swings past when the body
stops, and settles. The lag becomes an extra turn at the part's pivot, baked into the clip, and
chained parts (a tail made of several `tail` parts) each follow the one before. Looping clips are
simulated for three cycles and the last one is kept, so the clip still loops. Ears spring at
3.5 Hz, antennas at 3, hair at 2.5 and tails at 2.2, all with the same light damping.

`"secondary": false` on a clip turns it off.

## Clip types

**Loops:** `idle`, `walk`, `run`, `hop` (with squash and stretch), `fly`, `swim`, `drive`, `spin`
(the `target` or the whole model), `hover`, `wave` (the `target` arm, or the one on the model's
right), `nod`.

**Game actions** play once and are built from roles, so they work on any model:

| clip | what happens | without arms / legs |
|---|---|---|
| `attack` | wind up with the arm overhead, chop forward and down, come back; the body leans into it over planted feet | the head lunges and snaps |
| `jump` | crouch with a squash, leave the ground in a ballistic arc with the legs tucked and arms up, land with a squash | still jumps; nothing to tuck |
| `sit` | two legs: sit on the ground with the legs forward. Four or more: fold the back legs under and sit up on the front ones. Stays seated | sinks down |
| `turn` | a quarter turn to the left in place, in three small steps per foot (in the gait's pairs), the body following the feet | the body turns |
| `die` | stagger back, tip over onto the right side with gravity, a small bounce, lie still | falls the same way |

![attack, jump, sit, turn and die on the biped template](actions.png)

`sit` and `die` keep the model's lowest point on the ground the whole way, so it tips over the
edge it rests on instead of sinking or floating. `amplitude` scales every action (a turn of
`amplitude: 2` is a half turn).

`speed` multiplies the cycle rate, `amplitude` the motion size, `duration` sets the length (the
default is one natural cycle, so loops loop), and `fps` the export sample rate.

## Blending clips

A `blend` clip crossfades from one clip into another:

<!-- verify: clip biped -->
```json
{ "id": "walk_to_idle", "type": "blend", "from": "walk", "to": "idle", "duration": 0.4 }
```

The first clip keeps playing from its start while its weight eases out, and the second is timed
so it reaches its own first frame exactly when the blend ends. Play the blend, then the `to`
clip from its start, and there is no seam. Both clips must be ordinary clips in the same scene.

Engines can also blend at runtime, and the clips are made for it:

- **Loops start and end on the same pose**, and the one-shots start from rest and end at rest
  (or in their final pose for `sit`, `turn` and `die`), so a short crossfade (0.15–0.3 s) between
  any two of them never pops.
- **`walk` and `run` share a phase**: at the same normalized time, the same foot is forward. Blend
  them by normalized time (Godot `AnimationNodeBlendSpace1D` with sync, Unity blend trees, Unreal
  blend spaces), not by seconds, and the feet stay in step.
- **Match the movement speed** to `extras.speed` on the walk and run animations. A blend space
  between them works best with the parameter set to those two speeds.

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
below the ground, never touching it, feet sliding while they are down (the same sole points are
followed from touchdown to lift-off, against the clip's speed), or not moving at all. The `fused-unrelated` critic warns
*before* you animate when two moving parts are fused.

## Limits

No physics or retargeting. Feet are planted on flat ground only, and arms do not use IK. See the
[roadmap](../ROADMAP.md).
