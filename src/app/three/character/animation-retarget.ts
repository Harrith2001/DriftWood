import * as THREE from 'three';

/**
 * Retargets externally authored clips onto the character's skeleton.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The three animation exports do not agree on how they spell bone names, and
 * neither does the character mesh:
 *
 *   character.glb    mixamorig:Hips     → GLTFLoader sanitises to `mixamorigHips`
 *   anim-idle.glb    mixamorig:Hips     → `mixamorigHips`      binds
 *   anim-fall.glb    mixamorig:Hips     → `mixamorigHips`      binds
 *   anim-walk.glb    mixamorig_Hips     → `mixamorig_Hips`     DOES NOT BIND
 *
 * `PropertyBinding.sanitizeNodeName` strips reserved characters (`. : / [ ]`)
 * but leaves underscores alone, so the walk clip's tracks pointed at nodes that
 * did not exist. AnimationMixer ignores unresolved tracks silently: the action
 * reported a healthy weight of 1 while driving nothing at all, and the skeleton
 * fell back to its bind pose. That is the long-standing "T-pose while walking"
 * bug — not a blending problem, a name-matching problem.
 *
 * Rather than special-casing one separator, both sides are normalised down to
 * alphanumerics and matched on that, so any future export naming convention
 * resolves without another round of debugging.
 */

/** Strips separators so `mixamorig_Hips`, `mixamorig:Hips` and `mixamorigHips` all agree. */
function normalizeBoneName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/** Maps `normalised name → actual node name` for every bone on the character. */
export function buildSkeletonMap(root: THREE.Object3D): Map<string, string> {
  const map = new Map<string, string>();
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) map.set(normalizeBoneName(obj.name), obj.name);
  });
  return map;
}

export interface RetargetResult {
  readonly clip: THREE.AnimationClip;
  /** Tracks that resolved to a bone. */
  readonly bound: number;
  /** Tracks dropped because the character has no such bone. */
  readonly dropped: number;
}

/**
 * Rewrites every track to the character's own bone names and drops the ones it
 * has no bone for (typically finger tips), which would otherwise emit a
 * PropertyBinding warning every frame.
 *
 * The clip is also given a unique name: `AnimationMixer.clipAction()` caches by
 * clip name, and every Mixamo export is called `mixamo.com`, so three clips
 * sharing that name would hand back the *same* action three times and collapse
 * the animation set into one.
 */
export function retargetClip(
  source: THREE.AnimationClip,
  uniqueName: string,
  skeleton: ReadonlyMap<string, string>,
  /**
   * The character's own bind-pose hip transform. When supplied, root-bone
   * translation is rebased onto it and a gross orientation mismatch is
   * corrected — see `rebaseRootMotion` and `alignRootOrientation`.
   */
  hipsBind?: { position: THREE.Vector3; quaternion: THREE.Quaternion },
): RetargetResult {
  const tracks: THREE.KeyframeTrack[] = [];
  let dropped = 0;

  for (const track of source.tracks) {
    // Track names look like `<nodeName>.<property>` — split on the last dot so
    // node names containing dots survive.
    const splitAt = track.name.lastIndexOf('.');
    if (splitAt < 0) {
      dropped++;
      continue;
    }
    const nodeName = track.name.slice(0, splitAt);
    const property = track.name.slice(splitAt + 1);

    const actual = skeleton.get(normalizeBoneName(nodeName));
    if (!actual) {
      dropped++;
      continue;
    }

    const rewritten = track.clone();
    rewritten.name = `${actual}.${property}`;

    if (ROOT_BONE.test(actual)) {
      if (property === 'position') rebaseRootMotion(rewritten, hipsBind?.position);
      if (property === 'quaternion') alignRootOrientation(rewritten, hipsBind?.quaternion);
    }

    tracks.push(rewritten);
  }

  const clip = new THREE.AnimationClip(uniqueName, source.duration, tracks, source.blendMode);
  return { clip, bound: tracks.length, dropped };
}


/** Matches the rig's root bone, whatever prefix spelling the export used. */
const ROOT_BONE = /hips$/i;

/**
 * Rebases a root-bone translation track onto the character's bind pose.
 *
 * Two separate problems are solved here.
 *
 * *Baked travel.* Mixamo bakes locomotion into the hips unless "In Place" was
 * ticked, and `anim-walk.glb` drifts its hips ~335 model units (about 3.3 world
 * units) across a single loop. World position is owned entirely by the walk
 * controller and the arrival sequence, so that travel is pure error — the camera
 * tracked the controller while the mesh slid away from it, and the character
 * walked straight out of frame the moment forward or backward was pressed.
 *
 * *Mismatched origins.* The three exports do not even share a coordinate frame:
 * the hips sit near Z −95 in the idle clip and Z +84 in the walk clip, and their
 * vertical ranges (−12…5 against 85…97) do not overlap at all. Simply freezing
 * each clip at its own first frame therefore pinned each one somewhere
 * different, so every idle↔walk transition teleported the character.
 *
 * Anchoring all of them to the same bind-pose position fixes both: horizontal
 * channels are pinned there outright, while the vertical channel keeps its
 * animated *delta* so the gait's bob survives without carrying the export's
 * arbitrary offset with it.
 */
function rebaseRootMotion(track: THREE.KeyframeTrack, hipsBind?: THREE.Vector3): void {
  const values = track.values as Float32Array;
  if (values.length < 3) return;

  const baseX = hipsBind?.x ?? values[0];
  const baseY = hipsBind?.y ?? values[1];
  const baseZ = hipsBind?.z ?? values[2];
  const firstY = values[1];

  for (let i = 0; i < values.length; i += 3) {
    values[i] = baseX;
    values[i + 1] = baseY + (values[i + 1] - firstY);
    values[i + 2] = baseZ;
  }
}

/**
 * Beyond this the difference between a clip's opening pose and the rig's bind
 * pose is treated as an axis-convention error rather than an artistic choice.
 * A walk cycle may well start with the hips turned a little; it will not start
 * with them turned ninety degrees.
 */
const AXIS_MISMATCH_THRESHOLD = Math.PI / 4;

/**
 * Corrects a root-bone rotation track whose export used a different up-axis.
 *
 * `anim-walk.glb` comes from a different pipeline to the other two — different
 * bone-name separator, incompatible translation origins — and its hips are
 * rotated ninety degrees relative to the character's rig. Played back as-is the
 * character walked around lying flat on his face.
 *
 * The whole track is rotated by whatever constant turn maps its first frame onto
 * the bind pose, so the clip animates *relative* to the rig it is driving. Small
 * differences are left alone: a correction is only applied when the mismatch is
 * large enough to be a coordinate-system problem rather than a pose.
 */
function alignRootOrientation(track: THREE.KeyframeTrack, bind?: THREE.Quaternion): void {
  const values = track.values as Float32Array;
  if (!bind || values.length < 4) return;

  const first = new THREE.Quaternion(values[0], values[1], values[2], values[3]);
  if (first.angleTo(bind) < AXIS_MISMATCH_THRESHOLD) return;

  const correction = bind.clone().multiply(first.invert());
  const key = new THREE.Quaternion();

  for (let i = 0; i < values.length; i += 4) {
    key.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
    key.premultiply(correction);
    values[i] = key.x;
    values[i + 1] = key.y;
    values[i + 2] = key.z;
    values[i + 3] = key.w;
  }
}
