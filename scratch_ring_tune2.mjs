import * as THREE from 'three';

const PLANET_RADIUS = 36;
const SHIP_BLOCK_RADIUS = 3.0;
const MIN_WALK_GAP = 3;
const BUILDING_MAX_FOOTPRINT = 6;
const BUILDING_WORST_CASE_RADIUS = (BUILDING_MAX_FOOTPRINT / 2) * Math.SQRT2 + 1;

const BUILDING_RINGS = [
  { arcDistance: 16, count: 4, asset: 'iso' },
  { arcDistance: 32, count: 6, asset: 'sci' },
  { arcDistance: 48, count: 2, asset: 'milk' },
  { arcDistance: 64, count: 6, asset: 'sci4' },
  { arcDistance: 80, count: 4, asset: 'aband' },
  { arcDistance: 96, count: 2, asset: 'cyber1' },
  { arcDistance: 112, count: 2, asset: 'planet' },
];

function sph(latDeg, lonDeg) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
}
const SHIP_SPOT = sph(0, 0);
function tangentBasis(normal) {
  const hint = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(hint, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}
function ringPoint(center, theta, phi) {
  const { u, v } = tangentBasis(center);
  return center.clone().multiplyScalar(Math.cos(theta))
    .addScaledVector(u, Math.sin(theta) * Math.cos(phi))
    .addScaledVector(v, Math.sin(theta) * Math.sin(phi));
}

const perRingPlaced = BUILDING_RINGS.map(() => 0);
const RUNS = 300;
for (let run = 0; run < RUNS; run++) {
  const buildingOccupied = [{ spot: SHIP_SPOT, radius: SHIP_BLOCK_RADIUS }];
  const RING_PHI_OFFSET_STEP = 2.4;
  BUILDING_RINGS.forEach((ring, ringIndex) => {
    const thetaBase = ring.arcDistance / PLANET_RADIUS;
    const ringPhiOffset = ringIndex * RING_PHI_OFFSET_STEP;
    for (let i = 0; i < ring.count; i++) {
      const basePhi = (i / ring.count) * Math.PI * 2 + ringPhiOffset;
      let spot = null;
      for (let attempt = 0; attempt < 20 && !spot; attempt++) {
        const jitter = attempt < 15 ? 1 : 0;
        const phi = basePhi + (Math.random() * 2 - 1) * 0.12 * jitter;
        const theta = thetaBase + (Math.random() * 2 - 1) * (1.5 / PLANET_RADIUS) * jitter;
        const candidate = ringPoint(SHIP_SPOT, theta, phi);
        const clear = buildingOccupied.every((o) => (
          PLANET_RADIUS * candidate.angleTo(o.spot) >= BUILDING_WORST_CASE_RADIUS + o.radius + MIN_WALK_GAP
        ));
        if (clear) spot = candidate;
      }
      if (!spot) continue;
      buildingOccupied.push({ spot, radius: BUILDING_WORST_CASE_RADIUS });
      perRingPlaced[ringIndex] += 1;
    }
  });
}
let totalReq = 0, totalPlaced = 0;
BUILDING_RINGS.forEach((ring, i) => {
  totalReq += ring.count;
  totalPlaced += perRingPlaced[i];
  console.log(`ring ${i} (arc=${ring.arcDistance}, count=${ring.count}): avg placed ${(perRingPlaced[i]/RUNS).toFixed(2)}`);
});
console.log('required clearance:', (BUILDING_WORST_CASE_RADIUS*2 + MIN_WALK_GAP).toFixed(2));
console.log(`TOTAL: ${(totalPlaced/RUNS).toFixed(2)} / ${totalReq}`);
