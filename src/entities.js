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

function makeEarthTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1560c4';
  ctx.fillRect(0, 0, size, size / 2);

  const blobs = [
    [60, 60, 70, '#2d8f4e'], [160, 90, 50, '#2d8f4e'], [300, 50, 90, '#37a05c'],
    [400, 100, 60, '#2d8f4e'], [220, 160, 80, '#2d7d46'], [80, 180, 55, '#2d7d46'],
    [460, 180, 40, '#2d8f4e'], [340, 190, 45, '#37a05c'], [140, 40, 35, '#2d7d46'],
  ];
  for (const [x, y, r, color] of blobs) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 10; i++) {
    const x = (i * 97 + 30) % size;
    const y = (i * 53 + 10) % (size / 2);
    const r = 15 + (i % 4) * 6;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEarth(radius) {
  const group = new THREE.Group();
  const texture = makeEarthTexture();
  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0.05 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 64), mat);
  group.add(sphere);

  const atmoMat = new THREE.MeshBasicMaterial({ color: 0x4dd0ff, transparent: true, opacity: 0.08, side: THREE.BackSide });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.02, 48, 48), atmoMat);
  group.add(atmo);

  return group;
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
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: true });
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

export function createDrone() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x555a66, metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), bodyMat);
  group.add(body);

  const armMat = new THREE.MeshStandardMaterial({ color: 0x33363f, metalness: 0.5, roughness: 0.4 });
  const rotorPositions = [[0.8, 0, 0.8], [-0.8, 0, 0.8], [0.8, 0, -0.8], [-0.8, 0, -0.8]];
  const rotors = [];
  for (const [x, y, z] of rotorPositions) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), armMat);
    arm.position.set(x * 0.55, 0.05, z * 0.55);
    arm.rotation.x = Math.PI / 2;
    arm.rotation.z = Math.atan2(x, z);
    group.add(arm);

    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 10), armMat);
    rotor.position.set(x, 0.1, z);
    group.add(rotor);
    rotors.push(rotor);
  }
  group.userData.rotors = rotors;

  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), lightMat);
  light.position.set(0, -0.2, 0);
  group.add(light);
  group.userData.blinkLight = light;

  group.userData.radius = 1.1;
  group.userData.type = 'drone';
  return group;
}

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
