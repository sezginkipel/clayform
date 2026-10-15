# Importing Clayform models into Unreal Engine 5

Clayform exports standard glTF 2.0 binaries (`.glb`) fully compatible with Unreal Engine 5 (UE 5.0 through 5.5+), including Skeletal Meshes, Manny-compatible skeletons, IK Rig retargeting, UCX collision hulls, and equipment sockets.

## Recommended export command

```bash
clayform export goblin -o goblin.glb --skeleton unreal --engine unreal --collision parts --lods 0.5,0.2
```

## 1. Importing the .glb

1. Open your UE5 project and navigate to your `Content/Characters/` folder in the **Content Browser**.
2. Drag and drop `goblin.glb` into the Content Browser.
3. In the **FBX/glTF Import Options** dialog:
   - **Import Content Type**: `Geometry and Skinning Weights` (for rigged characters) or `Static Mesh` (for static props).
   - **Skeleton**: Leave empty to generate a new Skeleton, or choose an existing compatible UE skeleton.
   - **Import Mesh LODs**: Checked (Clayform's `_LOD1`, `_LOD2` will be assigned automatically).
   - **Import Animations**: Checked if you have procedural walk/idle cycles baked in.
   - **Material Import Method**: `Create New Instanced Materials` or `Create New Unique Materials`.
4. Click **Import All**.

## 2. Collision hulls (`UCX_`)

When exported with `--collision parts --engine unreal`:
- Clayform generates convex collision meshes named with the standard Unreal prefix: `UCX_<PartName>_01`.
- Unreal Engine's importer recognizes `UCX_` meshes automatically, assigns them as physical collision bodies, and hides them from visual rendering.
- Open the imported mesh, click **Show** -> **Simple Collision** to verify the convex hulls.

## 3. Equipment sockets

Clayform parts tagged with `socket: "hand_r"` export as nodes named `SOCKET_hand_r` parented to the corresponding skeleton bone (e.g., `hand_r`).

### Accessing in Blueprints:
You can attach weapons, shields, or particle emitters using the standard **Attach Component to Component** node:

```
[SpawnActor Weapon] ---> [AttachToComponent]
                             - Target: Weapon Mesh
                             - Parent: Character SkeletalMesh
                             - Socket Name: SOCKET_hand_r
                             - Location Rule: Snap to Target
                             - Rotation Rule: Snap to Target
```

In C++:
```cpp
WeaponMesh->AttachToComponent(
    GetMesh(),
    FAttachmentTransformRules::SnapToTargetIncludingScale,
    TEXT("SOCKET_hand_r")
);
```

## 4. Retargeting with IK Rig & Manny/Quinn

Clayform's `--skeleton unreal` flag outputs standard Unreal bone hierarchy:
`root` -> `pelvis` -> `spine_01` -> `spine_02` -> `spine_03` -> `neck_01` -> `head`
with limbs named `clavicle_l/r`, `upperarm_l/r`, `lowerarm_l/r`, `hand_l/r`, `thigh_l/r`, `calf_l/r`, `foot_l/r`.

To retarget animations from the Unreal Engine 5 Starter Content (Manny / Quinn):
1. Right-click in Content Browser -> **Animation** -> **IK Rig** -> choose your Clayform character skeleton -> name it `IK_Clayform`.
2. Open `IK_Clayform`:
   - Set Retarget Root: Right-click `pelvis` -> **Set Retarget Root**.
   - Add Chain: `Spine` (`spine_01` to `spine_03`).
   - Add Chain: `Head` (`neck_01` to `head`).
   - Add Chain: `LeftArm` (`upperarm_l` to `hand_l`).
   - Add Chain: `RightArm` (`upperarm_r` to `hand_r`).
   - Add Chain: `LeftLeg` (`thigh_l` to `foot_l`).
   - Add Chain: `RightLeg` (`thigh_r` to `foot_r`).
3. Right-click in Content Browser -> **Animation** -> **IK Retargeter**:
   - Source IK Rig: `IK_Mannequin` (included in UE5 mannequin).
   - Target IK Rig: `IK_Clayform`.
4. In the preview viewport, align the poses (T-Pose / A-Pose) if necessary.
5. In the asset browser, select any animation (e.g. `MM_Walk`, `MM_Run`, `MM_Jump`) and click **Export Selected Animations**.

## 5. Automated Engine Validation

Verify your asset passes all Unreal glTF standards before opening the editor:

```bash
clayform validate-engine goblin.glb --engine unreal
```
Outputs validation check list:
- Valid glTF 2.0 container & chunks
- Sanitized node names without spaces
- `UCX_` collision hull naming verified
- Socket nodes properly parented
- Animation channel target consistency
