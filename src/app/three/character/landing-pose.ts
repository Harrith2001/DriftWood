import * as THREE from 'three';

/**
 * Procedural three-point landing crouch.
 *
 * There is no landing clip in the animation set — only idle, walk and fall — so
 * the crouch is authored here as an additive bone pose layered on top of
 * whatever the mixer just wrote. It has to be applied *after* `mixer.update()`
 * each frame, because the mixer overwrites bone transforms wholesale.
 *
 * Rotations are applied in each bone's local space, which is why the hips can be
 * pitched forward without the legs shearing: the leg bones inherit the hip
 * rotation and are then counter-rotated relative to it, exactly as a real
 * skeleton behaves.
 */
export class LandingPose {
  /** Bones looked up once; missing ones are simply skipped. */
  private readonly bones: Partial<Record<BoneKey, THREE.Bone>> = {};

  private readonly scratch = new THREE.Quaternion();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);

  /**
   * Which of the wanted bones resolved against the loaded rig. Exposed so a
   * rig swap that silently renames bones is visible rather than presenting as
   * "the crouch does nothing".
   */
  get resolvedBones(): readonly string[] {
    return Object.entries(this.bones)
      .filter(([, bone]) => bone)
      .map(([key]) => key);
  }

  constructor(root: THREE.Object3D) {
    // Names are matched loosely: the rigs in this project spell the prefix
    // three different ways (`mixamorig:`, `mixamorig_`, `mixamorig`).
    const wanted: Record<BoneKey, RegExp> = {
      hips: /hips$/i,
      spine: /spine$/i,
      spine1: /spine1$/i,
      leftUpLeg: /leftupleg$/i,
      rightUpLeg: /rightupleg$/i,
      leftLeg: /leftleg$/i,
      rightLeg: /rightleg$/i,
      leftArm: /leftarm$/i,
      rightArm: /rightarm$/i,
      leftForeArm: /leftforearm$/i,
      rightForeArm: /rightforearm$/i,
    };

    root.traverse((obj) => {
      const bone = obj as THREE.Bone;
      if (!bone.isBone) return;
      const normalized = bone.name.replace(/[^a-z0-9]/gi, '').toLowerCase();
      for (const [key, pattern] of Object.entries(wanted) as [BoneKey, RegExp][]) {
        if (!this.bones[key] && pattern.test(normalized)) this.bones[key] = bone;
      }
    });
  }

  /**
   * @param amount 0 = untouched (mixer pose stands), 1 = full crouch
   */
  apply(amount: number): void {
    const k = THREE.MathUtils.clamp(amount, 0, 1);
    if (k <= 0.001) return;

    // Torso stays comparatively upright. Pitching the hips and both spine
    // joints hard folded the character almost double — a cannonball tuck rather
    // than someone absorbing an impact — so the lean is kept modest and the
    // weight is carried by the legs instead.
    this.rotate('hips', this.axisX, 0.26 * k);
    this.rotate('spine', this.axisX, 0.2 * k);
    this.rotate('spine1', this.axisX, 0.1 * k);

    // Thighs swing forward, shins fold back under — the landing squat.
    this.rotate('leftUpLeg', this.axisX, -0.92 * k);
    this.rotate('rightUpLeg', this.axisX, -0.92 * k);
    this.rotate('leftLeg', this.axisX, 1.45 * k);
    this.rotate('rightLeg', this.axisX, 1.45 * k);

    // One arm braced toward the ground, the other trailing back for balance.
    this.rotate('rightArm', this.axisZ, -0.75 * k);
    this.rotate('rightForeArm', this.axisX, 0.5 * k);
    this.rotate('leftArm', this.axisZ, 0.55 * k);
    this.rotate('leftForeArm', this.axisX, -0.3 * k);
  }

  /** Applies a local rotation on top of the bone's current animated pose. */
  private rotate(key: BoneKey, axis: THREE.Vector3, radians: number): void {
    const bone = this.bones[key];
    if (!bone) return;
    this.scratch.setFromAxisAngle(axis, radians);
    bone.quaternion.multiply(this.scratch);
  }

  /** How far the hips drop, in world units, at full crouch. */
  static readonly HIP_DROP = 0.42;
}

type BoneKey =
  | 'hips'
  | 'spine'
  | 'spine1'
  | 'leftUpLeg'
  | 'rightUpLeg'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftArm'
  | 'rightArm'
  | 'leftForeArm'
  | 'rightForeArm';
