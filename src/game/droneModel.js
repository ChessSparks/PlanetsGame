import * as THREE from 'three';

// Procedural quad-rotor drone built from primitives (previously loaded from
// drone.glb). Local -Z is the "face"/lens direction (three.js's own
// lookAt-forward convention) and local +Y is "up" (antenna) — this is what
// lets the per-frame lookAt() calls in the scenes aim the eye at the player
// while the antenna stays pointing up regardless of which way it's facing.
const DRONE_RADIUS = 0.65;
const SENTRY_RADIUS = 0.7;

const BODY_COLOR = 0xd8dde2;
const ACCENT_COLOR = 0x262b33;
const LENS_COLOR = 0x5fe0ff;

function buildDroneBody() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), bodyMat);
  body.scale.set(1, 0.72, 1.15);
  group.add(body);

  const accentMat = new THREE.MeshStandardMaterial({ color: ACCENT_COLOR, metalness: 0.7, roughness: 0.3 });
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.055, 8, 20), accentMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.02;
  group.add(collar);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 12),
    new THREE.MeshStandardMaterial({ color: LENS_COLOR, emissive: LENS_COLOR, emissiveIntensity: 1.4, roughness: 0.15 }),
  );
  lens.position.set(0, 0.02, -0.5);
  group.add(lens);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), accentMat);
  antenna.position.set(0, 0.53, 0.08);
  group.add(antenna);

  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff3344, emissiveIntensity: 1 }),
  );
  antennaTip.position.set(0, 0.69, 0.08);
  group.add(antennaTip);

  const hubMat = new THREE.MeshStandardMaterial({ color: 0x14161b, metalness: 0.7, roughness: 0.3 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide });
  const armAngles = [Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, (-3 * Math.PI) / 4];
  for (const angle of armAngles) {
    const armGroup = new THREE.Group();
    armGroup.rotation.y = angle;

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.1), accentMat);
    arm.position.set(0.42, 0.04, 0);
    armGroup.add(arm);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), hubMat);
    hub.position.set(0.68, 0.04, 0);
    armGroup.add(hub);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.015, 0.09), bladeMat);
    blade.position.set(0.68, 0.09, 0);
    armGroup.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.y = Math.PI / 2;
    armGroup.add(blade2);

    group.add(armGroup);
  }

  group.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return group;
}

function addBlinkLight(group, color) {
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color }));
  light.name = 'blinkLight';
  light.position.set(0, -0.4, 0.15);
  group.add(light);
  return light;
}

// Every clone built from the same shared materials would otherwise point at
// the exact same Material instances — reskinning the sentry variant red
// would silently recolor every plain drone too. Clone materials first so the
// sentry template (and everything built from it) owns independent copies.
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

// Builds one drone template — call this once per scene and clone it with
// cloneDrone() for each patrol/sentry instance rather than rebuilding.
export async function loadDroneTemplate() {
  const group = buildDroneBody();
  const light = addBlinkLight(group, 0xff2222);
  group.userData.blinkLight = light;
  group.userData.radius = DRONE_RADIUS;
  group.userData.type = 'drone';
  return group;
}

// Same model, reskinned darker/red for the client world's hostile sentries.
export async function loadSentryTemplate() {
  const group = buildDroneBody();
  cloneMaterials(group);
  tintHostile(group);
  const light = addBlinkLight(group, 0xff3322);
  group.userData.blinkLight = light;
  group.userData.radius = SENTRY_RADIUS;
  group.userData.type = 'sentry';
  return group;
}

// Cheap synchronous clone of an already-built template — safe to call from
// non-async code (e.g. ascentScene's buildLevel(), which reruns on every
// retry and can't itself await anything).
export function cloneDrone(template) {
  const clone = template.clone(true);
  clone.userData.radius = template.userData.radius;
  clone.userData.type = template.userData.type;
  clone.userData.blinkLight = clone.getObjectByName('blinkLight');
  return clone;
}
