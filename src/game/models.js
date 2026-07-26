import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
      return { model, height };
    }));
  }
  return rawCache.get(url);
}

// Returns a fresh clone scaled to targetHeight, wrapped so the wrapper's
// origin sits exactly at the model's feet.
export async function loadDecoration(url, targetHeight) {
  const { model, height } = await loadRaw(url);
  const clone = model.clone(true);
  clone.scale.setScalar(targetHeight / height);
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  return wrapper;
}
