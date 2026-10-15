# Importing Clayform models into Godot 4

Clayform exports standard glTF 2.0 binaries (`.glb`) ready for Godot 4.x out of the box, with animations, PBR materials, collision shapes, levels of detail (LODs), and equipment sockets.

## Recommended export command

```bash
clayform export goblin -o goblin.glb --skeleton humanoid --engine godot --collision parts --lods 0.5,0.2
```

## 1. Importing the .glb

1. Drag `goblin.glb` into your Godot project's `res://assets/` folder.
2. Select `goblin.glb` in the FileSystem dock and open the **Import Dock** (top-left).
3. Under **Meshes**:
   - `LODs`: Leave enabled (Godot detects `_LOD1`, `_LOD2` automatically).
   - `Light Baking`: Set to `Static` if you use baked lightmaps.
4. Under **Animation**:
   - `Import`: Enabled.
   - `Storage`: Save to Files or keep embedded.
5. Click **Reimport**.

## 2. Collision shapes

When exported with `--collision parts --engine godot`, collision hulls are named with Godot's `-convcolonly` suffix.
Godot automatically creates a `CollisionShape3D` with a `ConvexPolygonShape3D` for each part during import.

## 3. Equipment sockets

Clayform parts with `socket: "hand_r"` export as nodes named `SOCKET_hand_r` attached to the corresponding bone.

In Godot 4, you can attach weapons or items to sockets in two ways:

### Option A: BoneAttachment3D (Editor or Runtime)
```gdscript
extends CharacterBody3D

@onready var hand_socket = $Skeleton3D/SOCKET_hand_r

func equip_weapon(weapon_scene: PackedScene):
    var weapon = weapon_scene.instantiate()
    hand_socket.add_child(weapon)
```

### Option B: Node Search
```gdscript
func get_socket(socket_name: String) -> Node3D:
    return find_child("SOCKET_" + socket_name, true, false)
```

## 4. Retargeting Humanoid Animations

When exported with `--skeleton humanoid`, Clayform names bones following standard humanoid conventions (`Hips`, `Spine`, `Chest`, `UpperChest`, `Neck`, `Head`, `LeftUpperArm`, `LeftLowerArm`, `LeftHand`, `RightUpperArm`, `RightLowerArm`, `RightHand`, `LeftUpperLeg`, `LeftLowerLeg`, `LeftFoot`, `RightUpperLeg`, `RightLowerLeg`, `RightFoot`).

In Godot 4's Advanced Import Settings:
1. Select the `goblin.glb` -> click **Advanced**.
2. Under **Skeleton**, set **Retarget** -> **Bone Map** to `GeneralSkeleton` or load a standard humanoid profile.
3. Godot will automatically map 100% of the bones.
4. You can now share animations across all Clayform and Mixamo humanoid characters.

## 5. Facial Expressions & Morph Targets

Expressions like `blink`, `smile`, `open_mouth` export as standard glTF blend shapes (morph targets).

```gdscript
@onready var mesh_instance = $Skeleton3D/head_mesh

func set_expression(expr_name: String, weight: float):
    var idx = mesh_instance.find_blend_shape_by_name(expr_name)
    if idx != -1:
        mesh_instance.set_blend_shape_value(idx, clamp(weight, 0.0, 1.0))
```
