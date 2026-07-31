import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnimState, QualitySettings } from '../../core/models/experience.model';
import { GROUND_Y, YAW_PORTRAIT } from '../../core/world/world.config';
import { buildSkeletonMap, retargetClip } from './animation-retarget';
import { LandingPose } from './landing-pose';
import { disposeObject } from '../util/dispose';

/** Height the character is normalised to, in world units (metres). */
const TARGET_HEIGHT = 1.8;

/**
 * The visitor's avatar: mesh, skeleton, animation set and pose.
 *
 * Owns its own animation state machine. Every clip is pre-warmed at weight 0 and
 * left playing, so transitions are pure weight cross-fades — a clip is never
 * started from a stopped state mid-blend, which is what used to leave the rig
 * momentarily in its bind pose.
 */
export class Character {
  readonly root: THREE.Group;
  /** Distance from the model origin to the soles, so feet can be placed on ground. */
  readonly feetOffset: number;

  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimState, THREE.AnimationAction>();
  private state: AnimState = 'idle';

  /** Additive landing crouch, layered over the mixer output each frame. */
  private readonly landingPose: LandingPose;
  private crouchAmount = 0;

  constructor(
    gltf: GLTF,
    clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip; fall: THREE.AnimationClip },
    quality: QualitySettings,
  ) {
    this.root = gltf.scene;
    this.root.name = 'character';

    // Normalise scale to a believable human height regardless of export units.
    const bounds = new THREE.Box3().setFromObject(this.root);
    const size = bounds.getSize(new THREE.Vector3());
    this.root.scale.setScalar(TARGET_HEIGHT / size.y);

    const scaled = new THREE.Box3().setFromObject(this.root);
    this.feetOffset = -scaled.min.y;

    this.root.position.set(0, this.feetOffset + GROUND_Y, 0);
    this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), YAW_PORTRAIT);

    this.applyNaturalMaterials(quality);

    this.mixer = new THREE.AnimationMixer(this.root);
    const skeleton = buildSkeletonMap(this.root);

    // Read the hips before any action plays, while the rig is still in its bind
    // pose. Every clip's root translation is rebased onto this, so the three
    // exports — which do not share a coordinate frame — all drive the same body.
    const hipsBind = findHipsBindPosition(this.root);

    // The idle clip is authored as a complete loop: its closing pose returns to
    // within ~0.6° per bone of its opening one, so it cycles unnoticeably. An
    // earlier revision trimmed it to the first 50 frames, which cut across the
    // middle of a gesture — the pose there differs by ~12° per bone, so the
    // character visibly snapped back to attention every 1.7 seconds. Play it whole.
    this.register('idle', retargetClip(clips.idle, '__idle__', skeleton, hipsBind).clip);
    this.register('walking', retargetClip(clips.walk, '__walk__', skeleton, hipsBind).clip);
    this.register('falling', retargetClip(clips.fall, '__fall__', skeleton, hipsBind).clip);

    // Idle owns the pose until something asks otherwise.
    this.actions.get('idle')?.setEffectiveWeight(1);

    this.landingPose = new LandingPose(this.root);
  }

  private register(state: AnimState, clip: THREE.AnimationClip): void {
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.setEffectiveWeight(0);
    action.play();
    this.actions.set(state, action);
  }

  /**
   * Forces a matte PBR setup.
   *
   * The source model ships specular/glossiness maps that rendered as a wet
   * plastic sheen, and emissive hotspots bright enough to trip the bloom pass
   * (the red glints on the shirt). Skin and cloth want neither.
   */
  private applyNaturalMaterials(quality: QualitySettings): void {
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.castShadow = quality.shadows;
      mesh.receiveShadow = quality.shadows;
      // Skinned bounds are computed from the bind pose, so a limb thrown wide
      // mid-animation could cull the whole mesh at the screen edge.
      mesh.frustumCulled = false;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const mat = material as THREE.MeshStandardMaterial;
        if (!mat) continue;
        mat.metalness = 0;
        mat.roughness = Math.max(mat.roughness ?? 1, 0.9);
        mat.envMapIntensity = 0.25;
        mat.emissive?.setRGB(0, 0, 0);
        mat.emissiveIntensity = 0;
        mat.needsUpdate = true;
      }
    });
  }

  // ── Pose ───────────────────────────────────────────────────────────────────

  /** Places the feet at `groundY`, at world XZ. */
  setGroundPosition(x: number, z: number, groundY = GROUND_Y): void {
    this.root.position.set(x, this.feetOffset + groundY, z);
  }

  /** Places the origin at an explicit feet height, used during the arrival. */
  setFeetHeight(x: number, feetY: number, z: number): void {
    this.root.position.set(x, this.feetOffset + feetY, z);
  }

  setYaw(radians: number): void {
    this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
  }

  setQuaternion(q: THREE.Quaternion): void {
    this.root.quaternion.copy(q);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  // ── Animation ──────────────────────────────────────────────────────────────

  /** Cross-fades to `next`. Weights always sum to 1, so no bind-pose flicker. */
  transitionTo(next: AnimState, duration = 0.3): void {
    if (this.state === next) return;
    const from = this.actions.get(this.state);
    const to = this.actions.get(next);

    if (from && to) from.crossFadeTo(to.reset().setEffectiveWeight(1), duration, false);
    else to?.setEffectiveWeight(1);

    this.state = next;
  }

  /** Cancels any in-flight fade and snaps to a single clip at full weight. */
  snapTo(next: AnimState): void {
    for (const [state, action] of this.actions) {
      action.stopFading();
      action.setEffectiveWeight(state === next ? 1 : 0);
    }
    this.state = next;
  }

  get animationState(): AnimState {
    return this.state;
  }

  /** Scales walk playback so foot speed roughly tracks ground speed. */
  setWalkSpeed(multiplier: number): void {
    const walk = this.actions.get('walking');
    if (walk) walk.timeScale = multiplier;
  }

  /**
   * Sets the landing crouch, 0..1. Also lowers the body: bending the knees
   * without dropping the hips would leave the character hovering.
   */
  setCrouch(amount: number): void {
    this.crouchAmount = THREE.MathUtils.clamp(amount, 0, 1);
  }

  /** Vertical offset the current crouch implies, in world units. */
  get crouchDrop(): number {
    return this.crouchAmount * LandingPose.HIP_DROP;
  }

  update(delta: number): void {
    this.mixer.update(delta);
    // Must run after the mixer: it overwrites bone transforms wholesale, so an
    // additive pose applied earlier would simply be discarded.
    if (this.crouchAmount > 0.001) this.landingPose.apply(this.crouchAmount);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
    disposeObject(this.root);
  }
}

/**
 * The rig's hip transform in its bind pose.
 *
 * Every clip's root track is anchored to this, which is what lets three exports
 * with different origins and up-axes drive the same body.
 */
function findHipsBindPosition(
  root: THREE.Object3D,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } | undefined {
  let found: { position: THREE.Vector3; quaternion: THREE.Quaternion } | undefined;
  root.traverse((obj) => {
    if (found || !(obj as THREE.Bone).isBone) return;
    if (/hips$/i.test(obj.name.replace(/[^a-z0-9]/gi, ''))) {
      found = { position: obj.position.clone(), quaternion: obj.quaternion.clone() };
    }
  });
  return found;
}
