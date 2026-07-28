import * as THREE from 'three';
import { loadDecoration } from './models.js';

// drone.glb is a static, non-rigged orb-body drone (lens/ring/antenna
// parts, no skeleton or animation clips) that replaces the old procedural
// quad-rotor drones built directly in entities.js. Scaled so its visual
// footprint roughly matches the old drone's ~2.2-unit width — but the real
// gameplay hazard distance is userData.radius, set explicitly below to the
// exact same 1.1/1.2 values the old drones used, so collision behavior in
// every scene is unchanged regardless of the new model's own proportions.
const DRONE_MODEL_HEIGHT = 1.4;
const DRONE_RADIUS = 0.65;
const SENTRY_RADIUS = 0.7;

// loadDecoration's convention is feet-at-origin (built for characters/props
// that stand on the ground), but drones are positioned/oriented by their
// CENTER everywhere in this codebase (patrol orbits, hover altitude,
// obstacle checks) — so the loaded clone is shifted down by half its height
// on top of that normalization, making the returned wrapper's own origin
// the drone's visual center instead of its underside.
async function loadDroneBody() {
  const wrapper = await loadDecoration('/assets/drone.glb', DRONE_MODEL_HEIGHT);
  const inner = wrapper.children[0];
  inner.position.y = -DRONE_MODEL_HEIGHT / 2;
  // Aligns the lens/"eye" with local -Z (three.js's own lookAt-forward
  // convention) while leaving local +Y (the antennas) untouched — verified
  // with THREE's own Quaternion math, not hand-derived. This is what lets
  // the per-frame lookAt() calls in the scenes aim the eye at the player
  // while the antennas stay pointing up regardless of which way it's
  // currently looking. (Was +90°; the eye ended up facing backwards, so
  // this is the -90° sign flip — same axis math, opposite direction.)
  inner.rotation.y = -Math.PI / 2;
  return wrapper;
}

function addBlinkLight(group, color) {
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color }));
  light.name = 'blinkLight';
  light.position.set(0, -DRONE_MODEL_HEIGHT * 0.4, 0);
  group.add(light);
  return light;
}

// Materials loaded via GLTFLoader aren't cloned by Object3D.clone() — every
// instance built from the same cached raw model shares the same Material
// objects by default. Reskinning the sentry variant red would otherwise
// silently recolor every plain drone too, since they'd point at the exact
// same material instances. Cloning materials here first gives the sentry
// template (and everything built from it) its own independent copies.
function cloneMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material)
      ? node.material.map((m) => m.clone())
      : node.material.clone();
  });
}

function tintHostile(root) {
  const tint = new THREE.Color(0x3a1418);
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of materials) {
      if (mat.color) mat.color.lerp(tint, 0.55);
    }
  });
}

// Loads (and caches, via loadDecoration's own model cache) one drone
// template — call this once per scene and clone it with cloneDrone() for
// each patrol/sentry instance, rather than loading the glb repeatedly.
export async function loadDroneTemplate() {
  const group = await loadDroneBody();
  const light = addBlinkLight(group, 0xff2222);
  group.userData.blinkLight = light;
  group.userData.radius = DRONE_RADIUS;
  group.userData.type = 'drone';
  return group;
}

// Same model, reskinned darker/red for the client world's hostile sentries.
export async function loadSentryTemplate() {
  const group = await loadDroneBody();
  cloneMaterials(group);
  tintHostile(group);
  const light = addBlinkLight(group, 0xff3322);
  group.userData.blinkLight = light;
  group.userData.radius = SENTRY_RADIUS;
  group.userData.type = 'sentry';
  return group;
}

// Cheap synchronous clone of an already-loaded template — safe to call from
// non-async code (e.g. ascentScene's buildLevel(), which reruns on every
// retry and can't itself await a network fetch).
export function cloneDrone(template) {
  const clone = template.clone(true);
  clone.userData.radius = template.userData.radius;
  clone.userData.type = template.userData.type;
  clone.userData.blinkLight = clone.getObjectByName('blinkLight');
  return clone;
}
