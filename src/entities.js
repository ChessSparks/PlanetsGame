import * as THREE from 'three';

function makeGlowTexture(color) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(255,255,255,0.95)`);
  grad.addColorStop(0.25, `rgba(${color}, 0.55)`);
  grad.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// A visible sun disc with a soft glow halo. Fog is disabled on both so it
// stays bright and readable even placed far out in a hazy sky.
export function createSun(color, coreRadius) {
  const group = new THREE.Group();
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;

  const coreMat = new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(coreRadius, 24, 24), coreMat);
  group.add(core);

  const haloMat = new THREE.SpriteMaterial({
    map: makeGlowTexture(rgb), color: 0xffffff, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(coreRadius * 7);
  group.add(halo);

  return group;
}

// Plain THREE.Points render as flat squares (gl_PointCoord is a square by
// default) unless the material has a sprite texture masking each point down
// to a circle — barely visible at size ~1.4 but obviously square once a
// starfield's point size gets bigger. Built once and shared by every
// starfield instance.
let starSpriteTexture = null;
function getStarSprite() {
  if (starSpriteTexture) return starSpriteTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  starSpriteTexture = new THREE.CanvasTexture(canvas);
  return starSpriteTexture;
}

// fullSphere=false scatters stars over the upper hemisphere only (for a flat
// ground scene with sky above); fullSphere=true surrounds the camera on all
// sides (for a small planet floating in space, viewable from any angle).
export function createStarfield(count = 2000, spread = 900, fullSphere = false) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = spread * (0.5 + Math.random() * 0.5);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = fullSphere ? r * Math.cos(phi) : Math.abs(r * Math.cos(phi)) * 0.6 + 20;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.4,
    sizeAttenuation: true,
    map: getStarSprite(),
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

function makePlanetGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#173a1d';
  ctx.fillRect(0, 0, size, size);

  const patchColors = ['#0f2812', '#1a4020', '#123016', '#0c2410'];
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 22;
    ctx.fillStyle = patchColors[i % patchColors.length];
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 3);
  return texture;
}

// A small walkable planet: a full sphere with a dark green, slightly mottled
// surface. High segment counts keep the silhouette round at close range
// since the player stands right on top of it.
export function createPlanetGround(radius) {
  const texture = makePlanetGroundTexture();
  const mat = new THREE.MeshStandardMaterial({ map: texture, color: 0x2a6b38, roughness: 1, metalness: 0 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 96), mat);
  sphere.receiveShadow = true;
  sphere.userData.radius = radius;
  return sphere;
}

function makeMoonGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8c8c8f';
  ctx.fillRect(0, 0, size, size);

  const patchColors = ['#7d7d80', '#96969a', '#75757a', '#a3a3a6'];
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 4 + Math.random() * 14;
    ctx.fillStyle = patchColors[i % patchColors.length];
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Craters: a soft dark bowl with a brighter rim, painted straight into the
  // texture rather than modeled — much cheaper than displacing geometry.
  for (let i = 0; i < 45; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 30;
    const grad = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    grad.addColorStop(0, 'rgba(55,55,58,0.55)');
    grad.addColorStop(0.7, 'rgba(60,60,63,0.32)');
    grad.addColorStop(0.85, 'rgba(195,195,200,0.4)');
    grad.addColorStop(1, 'rgba(140,140,143,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 3);
  return texture;
}

// Same walkable-sphere convention as createPlanetGround, but gray cratered
// regolith instead of green terrain, for the post-orbit moon level.
export function createMoonGround(radius) {
  const texture = makeMoonGroundTexture();
  const mat = new THREE.MeshStandardMaterial({ map: texture, color: 0x9a9a9d, roughness: 1, metalness: 0 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 96), mat);
  sphere.receiveShadow = true;
  sphere.userData.radius = radius;
  return sphere;
}

function makeForgeGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1c1414';
  ctx.fillRect(0, 0, size, size);

  const patchColors = ['#241818', '#150f0f', '#2a1c1c', '#100c0c'];
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 20;
    ctx.fillStyle = patchColors[i % patchColors.length];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Glowing molten cracks — thin jagged lines with an orange glow, the
  // industrial/weaponized counterpart to the moon's painted craters.
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.strokeStyle = 'rgba(255,120,40,0.85)';
    ctx.lineWidth = 1.5 + Math.random();
    ctx.shadowColor = 'rgba(255,110,30,0.9)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 4 + Math.floor(Math.random() * 4);
    for (let s = 0; s < segments; s++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 3);
  return texture;
}

// A scorched, industrial world — the client's homeworld. Same walkable-
// sphere convention as createPlanetGround/createMoonGround, but dark ash
// with glowing molten cracks instead of foliage or craters.
export function createForgeGround(radius) {
  const texture = makeForgeGroundTexture();
  const mat = new THREE.MeshStandardMaterial({ map: texture, color: 0x55504f, roughness: 0.9, metalness: 0.1 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 96), mat);
  sphere.receiveShadow = true;
  sphere.userData.radius = radius;
  return sphere;
}

function makeAlienGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2a1638';
  ctx.fillRect(0, 0, size, size);

  const patchColors = ['#341a42', '#22102e', '#3c1f4c', '#1a0c24'];
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 22;
    ctx.fillStyle = patchColors[i % patchColors.length];
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Bioluminescent veins — thin glowing teal cracks, this world's answer to
  // the client world's molten-orange ones, but cold/alive instead of hot.
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.strokeStyle = 'rgba(80,255,220,0.85)';
    ctx.lineWidth = 1.2 + Math.random();
    ctx.shadowColor = 'rgba(80,255,220,0.9)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 4 + Math.floor(Math.random() * 4);
    for (let s = 0; s < segments; s++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 3);
  return texture;
}

// Mission V's alien world — same walkable-sphere convention as
// createPlanetGround/createMoonGround/createForgeGround, but violet/plum
// soil with glowing bioluminescent veins instead of grass, craters, or
// molten cracks — reads as unmistakably foreign at a glance.
export function createAlienGround(radius) {
  const texture = makeAlienGroundTexture();
  const mat = new THREE.MeshStandardMaterial({ map: texture, color: 0x5a4570, roughness: 0.9, metalness: 0.05 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 96), mat);
  sphere.receiveShadow = true;
  sphere.userData.radius = radius;
  return sphere;
}

export function createFuelCell() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffdd55, emissive: 0xffaa00, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.2,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), mat);
  group.add(core);
  group.userData.core = core;
  group.userData.radius = 0.9;
  group.userData.type = 'fuel';
  return group;
}

export function createBird() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b3b3b, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 8), mat);
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const wingGeo = new THREE.PlaneGeometry(1.1, 0.35);
  const wingL = new THREE.Mesh(wingGeo, mat);
  wingL.position.set(-0.1, 0, 0.4);
  const wingR = new THREE.Mesh(wingGeo, mat);
  wingR.position.set(-0.1, 0, -0.4);
  group.add(wingL, wingR);
  group.userData.wingL = wingL;
  group.userData.wingR = wingR;

  group.userData.radius = 0.9;
  group.userData.type = 'bird';
  return group;
}

// createDrone/createSentry (hostile drones/sentries) moved to
// game/droneModel.js and kept async (loadDroneTemplate/loadSentryTemplate)
// to match that module's template+clone loading pattern, even though the
// model itself is now built synchronously from primitives.

export function createSatellite() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.4, 12), bodyMat);
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a3d7a, metalness: 0.4, roughness: 0.5 });
  const panelGeo = new THREE.BoxGeometry(2.2, 0.05, 0.9);
  const panelL = new THREE.Mesh(panelGeo, panelMat);
  panelL.position.set(0, 0, 1.6);
  const panelR = new THREE.Mesh(panelGeo, panelMat);
  panelR.position.set(0, 0, -1.6);
  group.add(panelL, panelR);

  const antennaMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.7, roughness: 0.2 });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), antennaMat);
  antenna.position.set(0.9, 0, 0);
  antenna.rotation.z = Math.PI / 2;
  group.add(antenna);

  group.userData.radius = 1.9;
  group.userData.type = 'satellite';
  return group;
}

function makeGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8a8f96';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(60,64,70,0.5)';
  ctx.lineWidth = 2;
  const cell = 64;
  for (let i = 0; i <= size; i += cell) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }

  ctx.fillStyle = 'rgba(40,44,50,0.25)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 137) % size;
    const y = (i * 251) % size;
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + (i % 5) * 3, 5 + (i % 3) * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  return texture;
}

export function createGroundPlane(size) {
  const texture = makeGroundTexture();
  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0.05 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  return plane;
}

// Front faces local +Z, matching the rotation.y = atan2(dirX, dirZ) convention
// used throughout the ground scene (same as the character controller).
export function createGroundVehicle() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9542c, metalness: 0.3, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 2.2), bodyMat);
  body.position.y = 0.7;
  group.add(body);

  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.2, roughness: 0.5 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.15), cabinMat);
  cabin.position.set(0, 1.45, 0.3);
  group.add(cabin);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  const wheelPositions = [[0.65, 0.35, 0.7], [-0.65, 0.35, 0.7], [0.65, 0.35, -0.7], [-0.65, 0.35, -0.7]];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    group.add(wheel);
  }

  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), beaconMat);
  beacon.position.set(0, 1.85, 0);
  group.add(beacon);
  group.userData.beacon = beacon;

  group.userData.radius = 1.6;
  group.userData.type = 'vehicle';
  return group;
}

export function createRepairMarker() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.3,
  });
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), mat);
  marker.position.y = 1.1;
  group.add(marker);
  group.userData.marker = marker;
  group.userData.mat = mat;
  group.userData.radius = 1.6;
  return group;
}

export function markRepaired(repairGroup) {
  repairGroup.userData.mat.color.set(0x44ff77);
  repairGroup.userData.mat.emissive.set(0x22ff55);
}

export function createOrbitRing(radius) {
  const geo = new THREE.TorusGeometry(radius, 0.15, 12, 96);
  const mat = new THREE.MeshBasicMaterial({ color: 0x7bffb0, transparent: true, opacity: 0.65 });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI / 2;
  return ring;
}

// The client's spire — a tall, tapering, unmistakably fortified tower
// marking where the crystals get handed over. Deliberately looms rather
// than looking welcoming: wide dark base, narrowing black-metal shaft, and
// a pulsing red core near the top (the weapon's power intake).
export function createSpire() {
  const group = new THREE.Group();

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a1416, metalness: 0.5, roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.2, 3, 8), baseMat);
  base.position.y = 1.5;
  group.add(base);

  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x111014, metalness: 0.7, roughness: 0.35 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 3.6, 16, 8), shaftMat);
  shaft.position.y = 3 + 8;
  group.add(shaft);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x3a2020, metalness: 0.6, roughness: 0.3, emissive: 0x5a1810, emissiveIntensity: 0.6,
  });
  for (const t of [0.3, 0.55, 0.8]) {
    const y = 3 + t * 16;
    const r = THREE.MathUtils.lerp(3.6, 0.9, t) + 0.25;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.15, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  }

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff4422, emissive: 0xff2200, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.2,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), coreMat);
  core.position.y = 3 + 16 + 1.6;
  group.add(core);
  group.userData.core = core;

  group.userData.radius = 5.2;
  return group;
}

// A procedural industrial building — no matching glb asset exists, so this
// is a boxy warehouse/factory silhouette with a couple of roof vents and a
// chimney, randomized per call via width/depth/height so a scattered
// district doesn't look like the same building copy-pasted everywhere.
export function createIndustrialBuilding(width, depth, height) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2624, metalness: 0.35, roughness: 0.75 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a3230, metalness: 0.5, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMat);
  body.position.y = height / 2;
  group.add(body);

  const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(width * 1.03, height * 0.06, depth * 1.03), trimMat);
  roofTrim.position.y = height;
  group.add(roofTrim);

  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.06, width * 0.07, height * 0.4, 8),
    trimMat,
  );
  chimney.position.set(width * 0.28, height + height * 0.2, depth * 0.22);
  group.add(chimney);

  const ventCount = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < ventCount; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(width * 0.14, height * 0.08, depth * 0.14), trimMat);
    vent.position.set(
      (Math.random() - 0.5) * width * 0.6,
      height + height * 0.04,
      (Math.random() - 0.5) * depth * 0.6,
    );
    group.add(vent);
  }

  group.userData.radius = Math.max(width, depth) * 0.55;
  return group;
}

// A flat, slightly reflective rectangle laid on the surface as a paved
// street/lot beneath scattered buildings — this is what makes a cluster of
// boxes read as "district" instead of "boxes standing in a field."
// No baked-in rotation — orientToNormal() overwrites an object's quaternion
// entirely rather than composing with it, so any pre-set rotation here would
// just get discarded. Callers lay this flat via orientToNormal() followed by
// a relative pad.rotateX(-Math.PI / 2) (see how the ship's readyRing does
// the same thing in groundScene.js).
// The control tower — where the sentries get shut down once they've turned
// hostile. Deliberately utilitarian next to the spire's menace: a boxy
// mast with a radar dish and a blinking beacon, reading as "comms/security
// infrastructure" rather than "weapon."
export function createControlTower() {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.5, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.6), baseMat);
  base.position.y = 1.1;
  group.add(base);

  const mastMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, metalness: 0.6, roughness: 0.4 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 9, 8), mastMat);
  mast.position.y = 2.2 + 4.5;
  group.add(mast);

  const dishMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide });
  const dish = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), dishMat);
  dish.position.y = 2.2 + 9;
  dish.rotation.y = Math.PI / 4;
  dish.rotation.x = -0.4;
  group.add(dish);
  group.userData.dish = dish;

  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x66ffcc });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 10), beaconMat);
  beacon.position.y = 2.2 + 9.6;
  group.add(beacon);
  group.userData.beacon = beacon;

  // Matches CONTROL_TOWER_BLOCK_RADIUS in clientWorldScene.js — the real
  // solid base is only a 2.6x2.2x2.6 box (half-width 1.3, diagonal ~1.8).
  group.userData.radius = 1.6;
  return group;
}
