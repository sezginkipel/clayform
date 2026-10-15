# Importing Clayform models into Unity

Clayform exports `.glb` files that integrate cleanly with Unity's Mecanim Humanoid system, LOD Group components, and Mesh Colliders.

## Recommended export command

```bash
clayform export biped -o character.glb --skeleton humanoid --engine unity --collision parts --lods 0.5,0.2
```

## 1. Importing into Unity

1. Unity 2022+ and Unity 6 support glTF binaries out of the box (or with the official `com.unity.cloud.gltfast` package).
2. Place `character.glb` inside your project's `Assets/Models/` folder.
3. Select `character.glb` in the Project view to open the Inspector:
   - **Model Tab**:
     - `Scale Factor`: `1.0` (Clayform models are scaled in meters).
     - `Convert Units`: Enabled.
   - **Rig Tab**:
     - `Animation Type`: Choose **Humanoid**.
     - `Avatar Definition`: Choose **Create From This Model**.
     - Click **Apply** -> **Configure...** to verify. Clayform's bone names match Mecanim 1-to-1 (`Hips`, `Spine`, `Head`, `LeftUpperArm`, etc.), so the avatar will be green with zero manual mapping required.
   - **Animation Tab**:
     - All clips (`walk`, `attack`, `idle`) are imported. Enable `Loop Time` on looping clips.

## 2. Equipment Sockets

Parts with `socket: "hand_r"` export as child nodes named `SOCKET_hand_r` placed directly under the bone.

### Runtime Equipment in C#
```csharp
using UnityEngine;

public class CharacterEquipment : MonoBehaviour
{
    private Transform handSocket;

    void Awake()
    {
        // Find socket node under bone hierarchy
        Transform[] allChildren = GetComponentsInChildren<Transform>();
        foreach (Transform t in allChildren)
        {
            if (t.name == "SOCKET_hand_r")
            {
                handSocket = t;
                break;
            }
        }
    }

    public void EquipItem(GameObject itemPrefab)
    {
        if (handSocket == null) return;
        GameObject item = Instantiate(itemPrefab, handSocket);
        item.transform.localPosition = Vector3.zero;
        item.transform.localRotation = Quaternion.identity;
    }
}
```

## 3. BlendShapes (Expressions & Face Morphs)

Expressions (`blink`, `smile`, `open_mouth`) are imported as SkinnedMeshRenderer BlendShapes:

```csharp
SkinnedMeshRenderer smr = GetComponentInChildren<SkinnedMeshRenderer>();
int smileIndex = smr.sharedMesh.GetBlendShapeIndex("smile");
if (smileIndex >= 0)
{
    smr.SetBlendShapeWeight(smileIndex, 100f); // 0 to 100 in Unity
}
```

## 4. Collision Shapes

When exported with `--collision parts --engine unity`, collision meshes are named `<part>_collider`. You can attach a `MeshCollider` (with `convex = true`) directly to these nodes.
