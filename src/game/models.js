import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const rawCache = new Map();

// Some source assets aren't authored standing tall along +Y (e.g. modeled
// lying on their side), so their bounding box doesn't represent "height" the
// way our placement code expects. Fix up known offenders here with a one-time
// corrective rotation applied before normalization; empty by default.
const ORIENTATION_FIXES = {};

// Loads a glb once per url and normalizes it to a known height with feet at
// y=0, centered on x/z — same convention as the astronaut loader — so callers
// can scale/clone instances without re-measuring the source model each time.
function loadRaw(url) {
  if (!rawCache.has(url)) {
    rawCache.set(url, loader.loadAsync(url).then((gltf) => {
      const model = gltf.scene;
      model.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          // Some FBX->glTF exports bake in inverted winding (from a mirrored
          // or negative-scale transform in the source app) without flipping
          // the doubleSided flag, which makes the mesh backface-culled —
          // it loads fine but is invisible from outside. Force double-sided
          // rendering so that can never silently hide a model.
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of materials) {
            if (mat) mat.side = THREE.DoubleSide;
          }
        }
      });
      const fix = ORIENTATION_FIXES[url];
      if (fix) model.rotation.set(fix.x || 0, fix.y || 0, fix.z || 0);
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y || 1;
      model.position.x -= (box.max.x + box.min.x) / 2;
      model.position.z -= (box.max.z + box.min.z) / 2;
      model.position.y -= box.min.y;
      return { model, height, animations: gltf.animations };
    }));
  }
  return rawCache.get(url);
}

// Returns a fresh clone scaled to targetHeight, wrapped so the wrapper's
// origin sits exactly at the model's feet.
//
// Uses SkeletonUtils.clone(), not the plain Object3D.clone(true) — for a
// rigged/skinned model, the default clone() copies each SkinnedMesh's
// *reference* to the original skeleton rather than rebinding it to the
// newly cloned bones, so every instance beyond the first ends up skinned
// against bones it doesn't actually own. It doesn't always wreck the whole
// mesh — small extremities (hands, in one case) tend to visibly disappear
// first, since they're most sensitive to a mismatched bind matrix, while
// the rest of the body can still look mostly right. SkeletonUtils.clone()
// walks the hierarchy and rebinds skeletons to the clone's own bones
// correctly; it's also a safe no-op for models with no skeleton at all, so
// this applies to every loadDecoration call too, not just animated ones.
export async function loadDecoration(url, targetHeight) {
  const { model, height } = await loadRaw(url);
  const clone = cloneSkinned(model);
  const scaleFactor = targetHeight / height;
  clone.scale.setScalar(scaleFactor);
  // clone.position is inherited from the cached raw model, where it was set
  // to re-center the RAW (unscaled) geometry — feet at y=0, centered on x/z.
  // A node's translation is applied after its own scale, so that offset
  // must be scaled by the same factor or the centering drifts by
  // rawOffset * (1 - scaleFactor). Negligible for models close to their
  // target size, but for these building kits (authored at native heights in
  // the hundreds/thousands of units, scaled down by ~0.01-0.03x) that drift
  // is many units — the exact cause of buildings appearing to float or sink.
  clone.position.multiplyScalar(scaleFactor);
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  return wrapper;
}

// Same normalization/caching as loadDecoration, but also wires up an
// AnimationMixer for the clone's own clips (deer/stag etc. ship with a full
// animation set) — same fadeTo()-based crossfade pattern as character.js,
// onFinished included, for one-shot reaction clips that need to hand back
// control (e.g. a hit reaction) rather than just looping forever.
export async function loadAnimatedDecoration(url, targetHeight) {
  const { model, height, animations } = await loadRaw(url);
  const clone = cloneSkinned(model);
  const scaleFactor = targetHeight / height;
  clone.scale.setScalar(scaleFactor);
  // See loadDecoration above for why this also needs scaling: the
  // re-centering offset baked into the cached raw model is in unscaled
  // units, and a node's translation isn't affected by its own scale.
  clone.position.multiplyScalar(scaleFactor);
  const wrapper = new THREE.Group();
  wrapper.add(clone);

  const mixer = new THREE.AnimationMixer(clone);
  const actions = {};
  for (const clip of animations) {
    const name = clip.name.split('|')[1] || clip.name;
    actions[name] = mixer.clipAction(clip);
  }

  let current = null;
  function fadeTo(name, {
    duration = 0.4, loop = true, onFinished,
  } = {}) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.play();
    if (current) next.crossFadeFrom(current, duration, false);
    else next.fadeIn(duration);
    current = next;

    if (onFinished) {
      const handler = (e) => {
        if (e.action === next) {
          mixer.removeEventListener('finished', handler);
          onFinished();
        }
      };
      mixer.addEventListener('finished', handler);
    }
  }

  return {
    object3D: wrapper,
    actions,
    fadeTo,
    update(dt) { mixer.update(dt); },
  };
}
