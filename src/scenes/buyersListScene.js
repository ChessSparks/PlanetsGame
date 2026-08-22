import * as THREE from 'three';
import { createAlienGround, createSun } from '../entities.js';
import { loadAstronaut } from '../game/character.js';
import { loadDecoration } from '../game/models.js';
import { createPlanetWalker, fibonacciSphere, orientToNormal } from '../game/planet.js';
import {
  keys, consumeJumpPress, consumeInteractPress, consumeRollPress,
} from '../game/input.js';
import {
  hideHud, showOverlay, flashToast, announceObjective,
} from '../game/hud.js';
import { speak } from '../game/voice.js';
import { playMusicTheme, playAmbience, playPickupChime } from '../game/audio.js';
import { createMinimap } from '../game/minimap.js';
import { showMemoryMatchPuzzle } from '../game/memoryMatchPuzzle.js';
import { showSignalMazePuzzle } from '../game/signalMazePuzzle.js';
import { showFlappyBirdPuzzle } from '../game/flappyBirdPuzzle.js';
import { storyFlags } from '../game/storyFlags.js';

// One of each — not the same "memory" game three times, and none of them
// reused from the other levels (sliding-tile/sequence-repeat/rotate-connect/
// code-deduction): a pair-matching memory game, a small Pac-Man-style
// maze-chase, and a Flappy Bird clone. Shuffled per computer so it's not
// always the same spot running the same puzzle.
const COMPUTER_PUZZLES = [showMemoryMatchPuzzle, showSignalMazePuzzle, showFlappyBirdPuzzle];

function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Mission V, step one: just the planet itself, walkable and populated with
// its real assets (public/assets/fifth/), so it can actually be looked at
// before any story/objectives/hazards get built on top of it. No ship, no
// NPC, no terminal yet — those come once this reads right on its own.
const PLANET_RADIUS = 28;

const WALK_SPEED = 3.2;
const RUN_SPEED = 6.6;
const BACKWARD_SPEED = 2.0;
const TURN_SPEED = 2.4;

const JUMP_SPEED = 6.5;
const GRAVITY = 18;
const JUMP_SQUASH_REFERENCE = 0.4;
const JUMP_SQUASH_AMOUNT = 0.08;

const CAM_DISTANCE = 6.5;
const CAM_HEIGHT = 3.0;
const LOOK_HEIGHT = 1.4;

const SUN_DIRECTION = new THREE.Vector3(30, 70, -50).normalize();

const PLAYER_COLLISION_RADIUS = 0.45;
const EMBED = { flora: 0.15, ship: 0.5 };

// Real assets from public/assets/fifth/ — heights are first-pass guesses
// (no reference scale to measure against yet), easy to retune once seen
// in-game. Only the lava trees bundle into groves (see scatterTrees) —
// everything else (bush/plants/flowers/vines/flowerpot) scatters evenly
// across the whole planet instead of clumping, per explicit request.
// `embed` overrides EMBED.flora per-entry (vines/bushes sink deeper so they
// read as rooted in the ground rather than floating on it).
const TREE_HEIGHT = [3.5, 6.5];
const TREE_CLUSTER_COUNT = 18;
const TREES_PER_CLUSTER = 10;
const TREE_CLUSTER_RADIUS = 5;

const OTHER_FLORA = [
  // No blockRadiusFactor — passable by the player — embedded deeper so it
  // reads as growing out of the ground instead of sitting on top of it.
  {
    url: '/assets/fifth/alienBush.glb', height: [0.8, 1.5], weight: 9, embed: 0.4,
  },
  // Scaled way up from the original [0.6, 1.1] guess — a real alien-scale
  // plant now, not a shrub.
  { url: '/assets/fifth/alienPlants.glb', height: [3.0, 5.0], weight: 5 },
  { url: '/assets/fifth/alienflowers.glb', height: [0.4, 0.7], weight: 4 },
  { url: '/assets/fifth/alienflowerpot.glb', height: [0.5, 0.8], weight: 2 },
  // Sunk deep — "in the ground" rather than standing up off it.
  { url: '/assets/fifth/alienVine.glb', height: [0.7, 1.3], weight: 6, embed: 0.5 },
  { url: '/assets/fifth/alienVinesColorful.glb', height: [0.7, 1.3], weight: 4, embed: 0.5 },
];
const OTHER_FLORA_COUNT = 700;

// No dedicated grass asset exists — procedural, tinted orange per request.
// Bundled into big, dense patches ("grassy fields") rather than scattered
// thin and even. Rendered as a single InstancedMesh (see scatterGrass) —
// at this blade count (90*70 tufts * ~5-6 blades each, ~35k blades), one
// THREE.Mesh per blade would be tens of thousands of draw calls and tank
// frame rate; instancing keeps it to one.
const GRASS_PATCH_COUNT = 90;
const GRASS_PER_PATCH = 70;
const GRASS_PATCH_RADIUS = 7;
const GRASS_BLADES_PER_TUFT = [4, 7];

const CLOUD_COUNT = 36;
const CLOUD_ALTITUDE = 7;
const CLOUD_HIGH_COUNT = 16;
const CLOUD_HIGH_ALTITUDE = 13;

function sph(latDeg, lonDeg) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  );
}

const SPAWN_NORMAL = new THREE.Vector3(0, 1, 0);

// Generic "N well-spread spots, clear of these zones and each other" picker
// — hand-picking lat/lon pairs stopped being practical once the counts here
// scaled up (10 aliens, 3 computers, 10 houses). Verified with a standalone
// script against these exact parameters: all three counts (3/10/10 below)
// are reliably reached with candidateMultiplier=4.
function pickSpreadSpots(count, avoidZones, minSeparation, candidateMultiplier = 4) {
  const candidates = fibonacciSphere(count * candidateMultiplier);
  const picked = [];
  for (const p of candidates) {
    if (picked.length >= count) break;
    if (avoidZones.some((z) => p.angleTo(z.normal) < z.clear)) continue;
    if (picked.some((q) => p.angleTo(q) < minSeparation)) continue;
    picked.push(p.clone());
  }
  return picked;
}

const SHIP_SPOT = sph(60, 0);
const SHIP_BLOCK_RADIUS = 3.0;
// A real clearance radius around the landing site — nothing (flora,
// houses, computers, alien patrol centers) spawns within this, so the ship
// always sits in open ground instead of getting crowded by scenery.
const SHIP_CLEAR = 0.32;

const SHIP_AND_SPAWN_ZONES = [
  { normal: SPAWN_NORMAL, clear: 0.16 },
  { normal: SHIP_SPOT, clear: SHIP_CLEAR },
];

const COMPUTER_SPOTS = pickSpreadSpots(3, SHIP_AND_SPAWN_ZONES, 0.18);
const COMPUTER_CLEAR = 0.1;
// Floating above the surface rather than standing on it — height bobs
// gently around this base value (see updateComputers).
const COMPUTER_HOVER_HEIGHT = 1.3;
const COMPUTER_BOB_AMOUNT = 0.3;
// How far above the computer's own hover height the marker arrow floats.
const COMPUTER_ARROW_HEIGHT = 1.6;
const COMPUTER_ARROW_BOB_AMOUNT = 0.15;
const COMPUTER_INTERACT_RADIUS = 3.5;
const LIST_PICKUP_RADIUS = 2.2;
const SHIP_INTERACT_RADIUS = 4.6;
const COMPUTERS_NEEDED = 3;

const HOUSE_SPOTS = pickSpreadSpots(
  10,
  [...SHIP_AND_SPAWN_ZONES, ...COMPUTER_SPOTS.map((c) => ({ normal: c, clear: COMPUTER_CLEAR }))],
  0.12,
);
const HOUSE_CLEAR = 0.1;
const HOUSE_EMBED = 0.2;
const HOUSE_RADIUS = 1.7;
const HOUSE_SQUASH = 0.62;

// Every fixed landmark on the planet, in one place — flora and alien patrol
// centers both get filtered against this so nothing spawns on top of the
// ship, a computer, or a house.
const CLEAR_ZONES = [
  ...SHIP_AND_SPAWN_ZONES,
  ...COMPUTER_SPOTS.map((c) => ({ normal: c, clear: COMPUTER_CLEAR })),
  ...HOUSE_SPOTS.map((h) => ({ normal: h, clear: HOUSE_CLEAR })),
];

function inClearZone(normal) {
  return CLEAR_ZONES.some((z) => normal.angleTo(z.normal) < z.clear);
}

const LANDING_PAD_RADIUS = SHIP_BLOCK_RADIUS;
const LANDING_PAD_HEIGHT = 0.4;
// Sinks the pad's base into the terrain so its rim doesn't float above the
// curved surface (same idea as EMBED, just deep enough to cover a pad this
// wide) — see moonScene.js's landing pad for the reasoning in full.
const LANDING_PAD_EMBED = 0.5;
const LANDING_PAD_TOP_EMBED = LANDING_PAD_EMBED - LANDING_PAD_HEIGHT;

// orbitRadius cycles 4.0/4.7/5.4 by index (see ALIEN_PATROLS below) — this
// is the widest any alien's patrol loop ever swings from its center.
const MAX_ALIEN_ORBIT_RADIUS = 5.4;

// CLEAR_ZONES only keeps each landmark's *center point* free of alien
// centers (using each landmark's own small clearance — e.g. HOUSE_CLEAR is
// just 0.1 rad, ~2.8 units). It never accounted for the fact that an alien
// doesn't stay at its center — it sweeps a circle of orbitRadius (up to 5.4
// units) around it. A center picked just outside a house's 2.8-unit
// clearance still lets that alien's orbit path cut straight through the
// house's real collision obstacle (radius ~2.0, see obstacles.push below),
// so walking up to the alien there actually bounces off the house, not the
// alien. Same bug class as the tree fix (TREE_CLEAR_ZONES), applied here to
// every fixed obstacle instead of just trees: pad each landmark's clearance
// out by the full orbit radius plus its real obstacle radius plus a margin.
const ALIEN_LANDMARK_ZONES = [
  { normal: SPAWN_NORMAL, clear: (4.5 + MAX_ALIEN_ORBIT_RADIUS + 2) / PLANET_RADIUS },
  { normal: SHIP_SPOT, clear: (SHIP_BLOCK_RADIUS + MAX_ALIEN_ORBIT_RADIUS + 2) / PLANET_RADIUS },
  ...COMPUTER_SPOTS.map((c) => ({
    normal: c, clear: (0.7 + MAX_ALIEN_ORBIT_RADIUS + 2) / PLANET_RADIUS,
  })),
  ...HOUSE_SPOTS.map((h) => ({
    normal: h, clear: (HOUSE_RADIUS + 0.3 + MAX_ALIEN_ORBIT_RADIUS + 2) / PLANET_RADIUS,
  })),
];

// 10 patrol centers, spread across the planet and clear of every fixed
// landmark's full orbit sweep. Each alien loops a circle of `orbitRadius`
// around its own center, same math as the drones' orbitPosition() in the
// other levels, just at ground level instead of hovering — orbitRadius/
// speed/phase cycle through a few values by index so they don't all move
// identically.
const ALIEN_CENTERS = pickSpreadSpots(10, ALIEN_LANDMARK_ZONES, 0.08);
const ALIEN_PATROLS = ALIEN_CENTERS.map((center, i) => ({
  center, orbitRadius: 4.0 + (i % 3) * 0.7, speed: 0.28 + (i % 4) * 0.03, phase: i * 1.3,
}));

// Trees push a real collision obstacle (see scatterTrees); if one ever
// landed right at/near an alien's patrol loop, walking up to the alien
// would actually be hitting that invisible tree collider and bouncing back
// — reading as "the alien bounced me off" even though the alien itself has
// no collision at all. Keeping tree cluster centers clear of every patrol
// loop (with a margin past the widest orbitRadius) rules that out entirely.
const TREE_CLEAR_ZONES = [
  ...CLEAR_ZONES,
  // Margin covers the full possible jitter of an individual tree from its
  // *cluster* center (TREE_CLUSTER_RADIUS), not just the cluster center's
  // own distance to the patrol loop — a cluster center just outside a
  // smaller margin could still jitter a single tree right into the loop.
  ...ALIEN_PATROLS.map((p) => ({
    normal: p.center, clear: (p.orbitRadius + TREE_CLUSTER_RADIUS + 2) / PLANET_RADIUS,
  })),
];

function inTreeClearZone(normal) {
  return TREE_CLEAR_ZONES.some((z) => normal.angleTo(z.normal) < z.clear);
}
const ALIEN_HEIGHT = 2.0;
const ALIEN_WALK_SPEED = 2.2;
const ALIEN_BODY_RADIUS = 0.7;
// Negative embed = sits slightly above the surface rather than sunk into
// it. Using EMBED.flora (meant for flora blending flush into the ground)
// here meant the walk-bob's 0-to-0.15 range only ever brought aliens back
// up to flush at best, so the low half of every bob cycle visibly sank
// them into the terrain.
const ALIEN_GROUND_CLEARANCE = -0.05;

function tangentBasis(normal) {
  const hint = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(hint, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

// Exactly the same basis construction game/planet.js's orientToNormal uses
// internally (proven correct there for every other object on every planet
// in the game — trees, houses, computers, flora, the player), just
// parameterized by an explicit forward direction instead of a fixed hint.
// The aliens looked right when first placed with that method and wrong
// once they switched to Object3D.lookAt() for walking, so this replaces
// lookAt() with the same math that already works, driven by the alien's
// actual direction of travel.
function facingQuaternion(up, forward) {
  let right = new THREE.Vector3().crossVectors(forward, up);
  if (right.lengthSq() < 1e-8) {
    // Degenerate (forward ~parallel to up) — same fallback hint
    // orientToNormal uses, rather than producing a NaN rotation.
    const hint = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    right = new THREE.Vector3().crossVectors(hint, up);
  }
  right.normalize();
  const trueForward = new THREE.Vector3().crossVectors(up, right).normalize();
  const m = new THREE.Matrix4().makeBasis(right, up, trueForward.negate());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// Same technique as the client-world sentries: on a blocked step, slide
// along the obstacle's tangent (both directions) instead of clipping
// through it or freezing dead at it — this is what keeps aliens from
// walking straight through lava trees.
function moveToward(pos, target, maxStep) {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist <= maxStep || dist === 0) {
    pos.copy(target);
  } else {
    pos.x += (dx / dist) * maxStep;
    pos.y += (dy / dist) * maxStep;
    pos.z += (dz / dist) * maxStep;
  }
}

// Every exit path re-anchors pos to the exact surface radius (`target`'s own
// length, since alienWalkPosition always normalizes+rescales it there) rather
// than trusting whatever magnitude the Cartesian math above happened to land
// on. Without this, repeatedly sliding along an obstacle's tangent near a
// patrol loop's edge drifts pos inward step by step — nothing ever pulled it
// back out to the sphere, so over enough frames hugging a boundary an alien
// would visibly sink into the terrain (measured ~0.2 units deep in practice,
// on a body only 2 units tall).
function stepAvoidingObstacles(pos, target, maxStep, obstacles, bodyRadius) {
  const surfaceRadius = target.length();
  const snapToSurface = () => pos.normalize().multiplyScalar(surfaceRadius);
  const prev = pos.clone();
  moveToward(pos, target, maxStep);
  if (!hitsObstacle(pos.clone().normalize(), obstacles, bodyRadius)) { snapToSurface(); return; }

  pos.copy(prev);
  const toTarget = new THREE.Vector3().subVectors(target, prev);
  if (toTarget.lengthSq() < 1e-6) { snapToSurface(); return; }
  const outward = prev.clone().normalize();
  const perp = new THREE.Vector3().crossVectors(toTarget, outward).normalize();
  for (const dir of [perp, perp.clone().negate()]) {
    const candidate = prev.clone().addScaledVector(dir, maxStep);
    if (!hitsObstacle(candidate.clone().normalize(), obstacles, bodyRadius)) {
      pos.copy(candidate);
      snapToSurface();
      return;
    }
  }
  // Boxed in on all sides — hold position rather than clip through.
  snapToSurface();
}

// The *target* an alien's incremental step (see stepAvoidingObstacles
// above) walks toward, tracing a circle of `orbitRadius` around the patrol
// center. Unlike the drones' orbitPosition() (fine for something meant to
// hover), this adds the tangent offset to the *unit* center and
// re-normalizes before scaling to the ground radius — a walking creature
// needs to land exactly back on the sphere, not just near it, or it visibly
// hovers above the terrain by however much the offset failed to curve with
// the surface.
function alienWalkPosition(alien, elapsed, target = new THREE.Vector3()) {
  const t = elapsed * alien.speed + alien.phase;
  return target.copy(alien.center)
    .addScaledVector(alien.u, (Math.cos(t) * alien.orbitRadius) / PLANET_RADIUS)
    .addScaledVector(alien.v, (Math.sin(t) * alien.orbitRadius) / PLANET_RADIUS)
    .normalize()
    .multiplyScalar(PLANET_RADIUS - ALIEN_GROUND_CLEARANCE);
}

function placeOnSurface(object, normal, embed) {
  object.position.copy(normal).multiplyScalar(PLANET_RADIUS - embed);
}

// A built pad for the ship to rest on, same idea as the moon level's — a
// flat authored surface instead of the ship just sinking into raw terrain.
// Ring tinted to match the bioluminescent cloud/vein palette.
function createLandingPad() {
  const group = new THREE.Group();

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a3d52, metalness: 0.5, roughness: 0.5 });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(LANDING_PAD_RADIUS, LANDING_PAD_RADIUS * 1.08, LANDING_PAD_HEIGHT, 28),
    baseMat,
  );
  base.position.y = LANDING_PAD_HEIGHT / 2;
  base.receiveShadow = true;
  group.add(base);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xff5ad0, emissive: 0x6a1a58, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(LANDING_PAD_RADIUS * 0.75, 0.1, 10, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = LANDING_PAD_HEIGHT + 0.02;
  group.add(ring);

  return group;
}

// A procedural alien dwelling — no dedicated house asset exists yet, so
// this is built from primitives the same way createSpire/createControlTower
// are in the other levels: a squashed-dome pod with a glowing base ring and
// entrance, in the same magenta/teal bioluminescent palette as the clouds,
// ground veins, and landing pad.
function createAlienHouse() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a2a52, roughness: 0.85, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(HOUSE_RADIUS, 16, 12), bodyMat);
  body.scale.y = HOUSE_SQUASH;
  // The squashed sphere's own center sits at radius*squash above its lowest
  // point — placing it there puts that lowest point exactly at group-local
  // y=0, so it sits flush on the ground instead of floating or sinking.
  body.position.y = HOUSE_RADIUS * HOUSE_SQUASH;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xff5ad0, emissive: 0x6a1a58, emissiveIntensity: 0.8, metalness: 0.2, roughness: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(HOUSE_RADIUS * 0.9, 0.06, 8, 32), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);

  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x120818, emissive: 0x4affd8, emissiveIntensity: 1.1, roughness: 0.3,
  });
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), doorMat);
  // Was floating off the dome's actual surface: at half the dome's height
  // (the old y), the sphere's true cross-section is only ~0.87*HOUSE_RADIUS
  // wide, not the ~0.99*HOUSE_RADIUS depth the door was placed at — a
  // squashed sphere's widest cross-section (radius == HOUSE_RADIUS exactly)
  // is at its equator, i.e. at y == body.position.y, so that's where the
  // door needs to sit for the depth math to actually match the surface.
  door.position.set(0, HOUSE_RADIUS * HOUSE_SQUASH, HOUSE_RADIUS * 0.99);
  group.add(door);

  group.userData.radius = HOUSE_RADIUS + 0.3;
  return group;
}

// A small floating arrow above each unsolved computer — an in-world visual
// cue so it reads as "interact with this" once the player is close enough
// to see it, distinct from the minimap (which deliberately hides computers
// until solved, see updateMinimap — this doesn't defeat that, since it's
// only visible up close in the 3D world, not from across the planet).
// Teal to match the computer's own glow, apex pointing straight down at it.
function createComputerArrow() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a2820, emissive: 0x4affd8, emissiveIntensity: 1.4, metalness: 0.1, roughness: 0.3,
  });
  // ConeGeometry's apex faces its local +Y by default; orientToNormal below
  // (applied to the group, not this mesh) aligns the group's +Y outward
  // away from the planet, so the flip has to live on the child instead —
  // same reason createAlienHouse/createBuyerListPickup wrap their meshes in
  // a group rather than orienting the mesh directly.
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 4), mat);
  cone.rotation.x = Math.PI;
  group.add(cone);
  return group;
}

// The compiled buyer's list — spawned once all 3 computers are solved.
// Procedural (no dedicated asset for it): a glowing crystal shard, same
// bioluminescent magenta as the rest of the level's tech/lighting accents.
function createBuyerListPickup() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a0a20, emissive: 0xff5ad0, emissiveIntensity: 1.2, metalness: 0.2, roughness: 0.25,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mat);
  group.add(core);
  group.userData.core = core;
  return group;
}

function hitsObstacle(normal, obstacles, bodyRadius = PLAYER_COLLISION_RADIUS) {
  for (const obs of obstacles) {
    const arc = PLANET_RADIUS * normal.angleTo(obs.normal);
    if (arc < bodyRadius + obs.radius) return true;
  }
  return false;
}

// A vertical gradient used directly as scene.background (three.js accepts a
// Texture there, not just a flat Color) — purple zenith bleeding down into a
// tequila-sunrise orange/gold near the horizon, rather than a single flat
// sky color.
function createSkyGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#3a2060');
  grad.addColorStop(0.35, '#8a4a86');
  grad.addColorStop(0.62, '#e2703c');
  grad.addColorStop(1, '#ffc266');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Bioluminescent "spore clouds" instead of recolored cumulus — each one
// glows a random hue from the same magenta/teal/violet spectrum as the
// ground's veins and pulses slowly, with a few thin glowing tendrils
// trailing beneath (a nod to the planet's vine flora). What actually reads
// as "alien sky" rather than "normal clouds tinted purple."
const CLOUD_HUES = [0xff5ad0, 0x4affd8, 0xb388ff, 0x6ad0ff];

function createCloudPuff() {
  const group = new THREE.Group();
  const hue = CLOUD_HUES[Math.floor(Math.random() * CLOUD_HUES.length)];
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf4f0ff, emissive: hue, emissiveIntensity: 0.6, roughness: 1, metalness: 0, transparent: true, opacity: 0.72,
  });
  const puffCount = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < puffCount; i++) {
    const r = 0.5 + Math.random() * 0.65;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat);
    puff.position.set((Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 1.5);
    group.add(puff);
  }

  const tendrilMat = new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.55, depthWrite: false });
  const tendrilCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < tendrilCount; i++) {
    const length = 0.8 + Math.random() * 1.4;
    const tendril = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.008, length, 5), tendrilMat);
    tendril.position.set((Math.random() - 0.5) * 1.6, -length / 2 - 0.3, (Math.random() - 0.5) * 1.0);
    group.add(tendril);
  }

  const scale = 0.7 + Math.random() * 0.9;
  group.scale.setScalar(scale);
  group.userData.mat = mat;
  group.userData.pulsePhase = Math.random() * Math.PI * 2;
  group.userData.pulseSpeed = 0.5 + Math.random() * 0.5;
  return group;
}

function createCloudLayer() {
  const layer = new THREE.Group();
  const clouds = [];
  const points = fibonacciSphere(CLOUD_COUNT);
  for (const point of points) {
    const cloud = createCloudPuff();
    cloud.position.copy(point).multiplyScalar(PLANET_RADIUS + CLOUD_ALTITUDE);
    orientToNormal(cloud, point, Math.random() * Math.PI * 2);
    layer.add(cloud);
    clouds.push(cloud);
  }
  layer.userData.clouds = clouds;
  return layer;
}

// Thin glowing streaks up high — the same bioluminescent hues as the spore
// clouds below, but ribbon-like (an aurora-ish high layer) rather than puffy.
function createWispyCloud() {
  const group = new THREE.Group();
  const hue = CLOUD_HUES[Math.floor(Math.random() * CLOUD_HUES.length)];
  const mat = new THREE.MeshBasicMaterial({
    color: hue, transparent: true, opacity: 0.4, depthWrite: false,
  });
  const wispCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < wispCount; i++) {
    const wisp = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.4, 8, 6), mat);
    wisp.scale.set(3 + Math.random() * 2.5, 0.35, 1);
    wisp.position.set((Math.random() - 0.5) * 3.5, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 1.2);
    group.add(wisp);
  }
  group.userData.mat = mat;
  group.userData.baseOpacity = mat.opacity;
  group.userData.pulsePhase = Math.random() * Math.PI * 2;
  group.userData.pulseSpeed = 0.4 + Math.random() * 0.4;
  return group;
}

function createHighCloudLayer() {
  const layer = new THREE.Group();
  const clouds = [];
  const points = fibonacciSphere(CLOUD_HIGH_COUNT);
  for (const point of points) {
    const cloud = createWispyCloud();
    cloud.position.copy(point).multiplyScalar(PLANET_RADIUS + CLOUD_HIGH_ALTITUDE);
    orientToNormal(cloud, point, Math.random() * Math.PI * 2);
    layer.add(cloud);
    clouds.push(cloud);
  }
  layer.userData.clouds = clouds;
  return layer;
}

export async function createBuyersListScene({ onComplete } = {}) {
  hideHud();
  playMusicTheme('moon'); // placeholder theme until this level gets its own
  playAmbience('moon');

  const scene = new THREE.Scene();
  // A bright daytime sky — purple at the zenith bleeding into a tequila-
  // sunrise orange/gold near the horizon — rather than a night backdrop or
  // a single flat color.
  scene.background = createSkyGradientTexture();
  scene.fog = new THREE.Fog(0xc47a56, 55, 170);

  scene.add(new THREE.AmbientLight(0x9a86c8, 0.85));
  const sun = new THREE.DirectionalLight(0xffe8d8, 1.5);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(100);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  sun.shadow.bias = -0.0015;
  sun.target = new THREE.Object3D();
  scene.add(sun);
  scene.add(sun.target);
  const shadowLightOffset = SUN_DIRECTION.clone().multiplyScalar(30);

  const sunMesh = createSun(0xffe8d8, 8);
  sunMesh.position.copy(SUN_DIRECTION).multiplyScalar(220);
  scene.add(sunMesh);

  const cloudLayer = createCloudLayer();
  scene.add(cloudLayer);
  const highCloudLayer = createHighCloudLayer();
  scene.add(highCloudLayer);

  const planet = createAlienGround(PLANET_RADIUS);
  scene.add(planet);

  const walker = createPlanetWalker(SPAWN_NORMAL.clone(), new THREE.Vector3(0, 0, -1));
  const obstacles = [];
  let jumpVelocity = 0;
  let jumpHeight = 0;
  const minimap = createMinimap();

  const astronaut = await loadAstronaut();
  scene.add(astronaut.object3D);
  astronaut.fadeTo('Idle', { duration: 0 });

  const landingPad = createLandingPad();
  placeOnSurface(landingPad, SHIP_SPOT, LANDING_PAD_EMBED);
  orientToNormal(landingPad, SHIP_SPOT, 0);
  scene.add(landingPad);

  const ship = await loadDecoration('/assets/spaceship.glb', 6.5);
  placeOnSurface(ship, SHIP_SPOT, EMBED.ship + LANDING_PAD_TOP_EMBED);
  orientToNormal(ship, SHIP_SPOT, 0);
  scene.add(ship);
  obstacles.push({ normal: SHIP_SPOT.clone(), radius: SHIP_BLOCK_RADIUS });

  // Floating rather than standing on the ground — hover height bobs gently
  // and each one slowly spins in place (accumulated rotation is safe here,
  // unlike the earlier alien-bob bug, since it's the only thing being
  // accumulated; position is recomputed fresh from spot+bob every frame).
  const shuffledPuzzles = shuffled(COMPUTER_PUZZLES);
  const computers = await Promise.all(COMPUTER_SPOTS.map(async (spot, i) => {
    const mesh = await loadDecoration('/assets/fifth/alienComputer.glb', 1.4);
    orientToNormal(mesh, spot, 0);
    scene.add(mesh);
    obstacles.push({ normal: spot.clone(), radius: 0.7 });
    const arrow = createComputerArrow();
    scene.add(arrow);
    return {
      mesh, spot, phase: Math.random() * Math.PI * 2, solved: false, showPuzzle: shuffledPuzzles[i], arrow,
    };
  }));
  let computersSolved = 0;
  let buyersList = null; // { mesh, spot } — spawned once all 3 computers are solved

  // Procedural (see createAlienHouse) — synchronous, no loading involved.
  for (const spot of HOUSE_SPOTS) {
    const house = createAlienHouse();
    placeOnSurface(house, spot, HOUSE_EMBED);
    orientToNormal(house, spot, Math.random() * Math.PI * 2);
    scene.add(house);
    obstacles.push({ normal: spot.clone(), radius: house.userData.radius });
  }

  // Static loadDecoration (not loadAnimatedDecoration) — whether alien.glb
  // has usable walk-cycle clips isn't known yet. A per-mesh leg-swing
  // heuristic (guessing "legs" from bounding-box position) was tried and
  // pulled in unrelated parts of the model — looked like eyes detaching
  // from the body — so movement animation is a whole-body bob/waddle
  // instead (see updateAliens), safe regardless of the model's structure.
  const aliens = await Promise.all(ALIEN_PATROLS.map(async (patrol) => {
    const mesh = await loadDecoration('/assets/fifth/alien.glb', ALIEN_HEIGHT);
    scene.add(mesh);
    const basis = tangentBasis(patrol.center);
    // groundPos is the real, stable, stepped position on the sphere;
    // mesh.position is recomputed from it each frame (groundPos + a bob
    // offset) rather than being bobbed directly — accumulating the bob
    // straight into mesh.position was the earlier "aliens fly into the
    // sky" bug: the correction step back down (~0.035 units/frame) was far
    // smaller than the bob added every frame (up to 0.15), so it climbed
    // without bound instead of oscillating in place.
    const alien = {
      ...patrol, mesh, ...basis, walkPhase: Math.random() * Math.PI * 2, groundPos: new THREE.Vector3(),
    };
    // Starts exactly on its patrol loop rather than at the mesh's default
    // (0,0,0) — without this it would walk in from the planet's center over
    // the first several seconds, stepAvoidingObstacles's maxStep being far
    // smaller than the distance from the origin to the surface.
    alienWalkPosition(alien, 0, alien.groundPos);
    mesh.position.copy(alien.groundPos);
    return alien;
  }));
  // Real solid bodies now, not just roaming set-dressing: each entry shares
  // the *same* groundPos Vector3 the alien's own stepAvoidingObstacles
  // mutates every frame (see updateAliens), so this list tracks their
  // current positions with no per-frame rebuild needed. Kept separate from
  // `obstacles` (the static ship/computer/house/tree list) rather than
  // merged into it — aliens must never show up in their *own*
  // stepAvoidingObstacles call (an alien is always "inside" its own
  // radius) or in each other's, which would make every alien perpetually
  // stuck avoiding its neighbors; only the player's collision check below
  // needs to see them.
  const alienObstacles = aliens.map((alien) => ({ normal: alien.groundPos, radius: ALIEN_BODY_RADIUS }));
  const alienOrbitTarget = new THREE.Vector3();
  const alienUpTemp = new THREE.Vector3();
  const alienForwardTemp = new THREE.Vector3();

  scatterTrees(scene, obstacles);
  scatterOtherFlora(scene);
  scatterGrass(scene);

  let snapCameraNext = true;
  // 'intro' | 'playing' | 'puzzle' — movement/interact are gated off until
  // the intro's dismissed and while a computer puzzle overlay is up, same
  // convention as every other scene's states.
  let state = 'intro';

  function announce(text) {
    announceObjective(text);
    speak(text);
  }

  // Bridges from clientWorldScene's ending — refusing didn't stop the
  // client from moving the crystals anyway, so Corthana traced the
  // manifests here instead. Ties back explicitly to the client's own reveal
  // ("Every non-plant life-sign in this system. Gone quietly, from orbit.")
  // — the buyer's list isn't a loose plot thread, it's specifically a hunt
  // for whichever of these four is doing that to someone else right now.
  showOverlay(
    'The Exchange',
    'Corthana: You didn\'t hand over the crystals, but that won\'t stop them for long — someone else will make this delivery if we don\'t get ahead of it. I traced the client\'s manifests here.\n\n'
    + 'This isn\'t the client\'s world. It\'s where the client\'s clients keep their books — somewhere on that list is whoever\'s actually been wiping out non-plant life, planet by planet.\n\n'
    + 'Find the terminals. Pull the list.\n\nW/↑: Walk   S/↓: Back   A/D: Turn   Shift: Run   Space: Jump   E: Interact',
    'Begin',
    () => {
      state = 'playing';
      snapCameraNext = true;
      flashToast('Find the 3 alien computers and activate them.', 3200);
      announce('Objective: find and activate the 3 alien computers.');
    },
  );

  function handleComputerInteract(computer) {
    astronaut.playFlourish('Interact');
    if (computer.solved) {
      flashToast('Already active.', 1600);
      return;
    }
    state = 'puzzle';
    computer.showPuzzle(
      () => {
        computer.solved = true;
        computersSolved += 1;
        state = 'playing';
        playPickupChime();
        if (computersSolved >= COMPUTERS_NEEDED) {
          flashToast('All computers active!', 2200);
          spawnBuyersList();
        } else {
          flashToast(`Computer activated! (${computersSolved}/${COMPUTERS_NEEDED})`, 2200);
        }
      },
      () => {
        state = 'playing';
      },
    );
  }

  function handleListPickup() {
    astronaut.playFlourish('Interact');
    buyersList.collected = true;
    scene.remove(buyersList.mesh);
    playPickupChime();
    state = 'puzzle'; // reuse the same movement-lock the computer puzzles use, just for the overlay
    showOverlay(
      'The List',
      'The archive spits out the list all at once — names, coordinates, delivery windows going back further than you expected.\n\n'
      + 'Corthana, quiet: "...That\'s a lot of planets. Let\'s get this back to the ship before anyone here notices it\'s gone."',
      'Continue',
      () => {
        state = 'playing';
        announce('Objective: get back to the ship.');
      },
    );
  }

  // The level's actual close-out, gated behind having the list in hand —
  // arriving here used to be an instant win the moment the list was picked
  // up, with no reason to ever go back to the ship. `shipDeparted` guards
  // against firing this twice if E gets pressed again during the overlay
  // sequence (interact is locked out anyway via state !== 'playing', but the
  // flag makes that explicit rather than relying only on the state gate).
  let shipDeparted = false;
  function handleShipInteract() {
    astronaut.playFlourish('Interact');
    if (!buyersList || !buyersList.collected) {
      flashToast('Not yet — the list is still out there somewhere.', 2400);
      return;
    }
    if (shipDeparted) return;
    shipDeparted = true;
    state = 'ending';
    // The closing beat used to be stapled to the end of the client-world
    // level (Mission IV) — moved here since this is whichever mission is
    // currently last. If a Mission VI ever exists, this handoff moves again.
    // Entry 4 is corrupted by default; Smite Colony's alien chase (a
    // separate, non-blocking side activity there) can partially recover it
    // ahead of time — first name only, surname still gone — via storyFlags.
    const fourthEntry = storyFlags.fourthClientFirstName
      ? `4. ${storyFlags.fourthClientFirstName} [SURNAME CORRUPTED] — Unknown`
      : '4. [ENTRY CORRUPTED] — Unknown';
    const screens = [
      {
        title: 'The Buyer\'s List',
        body: 'BUYER\'S LIST — PARTIAL RECOVERY\n\n'
          + '1. Kaross Vey — Smite Colony\n'
          + '2. The Meridian Concern — Veyra Station\n'
          + '3. Ilsa Ductane — Coral Reach\n'
          + `${fourthEntry}\n\n`
          + 'Four names. Four planets. Whichever one of them bought enough crystals to end a world, the list alone doesn\'t say.',
      },
      {
        title: 'Some Time Later',
        body: 'You didn\'t deliver the weapon. You don\'t know what happens to the people who were counting on it. You didn\'t get paid.\n\nYou got to keep being someone you could live with.',
      },
      {
        title: 'One of Them',
        body: 'Corthana, scrolling the list again: "Four buyers. One of them is out there right now, wiping out every non-plant life-sign on some planet from orbit — same as almost happened to the client\'s. We don\'t know which yet."\n\n"We will."',
      },
    ];
    let i = 0;
    function next() {
      if (i >= screens.length) {
        onComplete?.();
        return;
      }
      const s = screens[i++];
      const isLast = i >= screens.length;
      showOverlay(s.title, s.body, isLast ? 'Depart' : 'Continue', next);
    }
    next();
  }

  // Purely cosmetic — no gameplay effect, just a flourish for the fun of it.
  function updateRoll() {
    if (consumeRollPress()) astronaut.playFlourish('Roll', { duration: 0.1, returnDuration: 0.25 });
  }

  // A single consumeInteractPress() per frame shared across every
  // interactable — calling it more than once would silently drop whichever
  // check ran later, since the press is one-shot.
  function updateInteract() {
    if (!consumeInteractPress()) return;
    const playerNormal = walker.normal;

    for (const computer of computers) {
      if (computer.solved) continue;
      const dist = PLANET_RADIUS * playerNormal.angleTo(computer.spot);
      if (dist <= COMPUTER_INTERACT_RADIUS) {
        handleComputerInteract(computer);
        return;
      }
    }

    if (buyersList && !buyersList.collected) {
      const dist = PLANET_RADIUS * playerNormal.angleTo(buyersList.spot);
      if (dist <= LIST_PICKUP_RADIUS) { handleListPickup(); return; }
    }

    const shipDist = PLANET_RADIUS * playerNormal.angleTo(SHIP_SPOT);
    if (shipDist <= SHIP_INTERACT_RADIUS) handleShipInteract();
  }

  // Spawned once all 3 computers are solved — a random spot clear of every
  // fixed landmark, not one of the fibonacci-even patch/cluster grids the
  // flora/aliens use, since this is a one-off single object.
  function spawnBuyersList() {
    const candidates = fibonacciSphere(60).filter((p) => !inClearZone(p));
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    const mesh = createBuyerListPickup();
    scene.add(mesh);
    buyersList = {
      mesh, spot, collected: false,
    };
    announce('Objective: recover the buyer\'s list.');
  }

  function updateBuyersList(elapsed) {
    if (!buyersList || buyersList.collected) return;
    const height = 1.2 + Math.sin(elapsed * 0.9) * 0.2;
    buyersList.mesh.position.copy(buyersList.spot).multiplyScalar(PLANET_RADIUS + height);
    buyersList.mesh.rotation.y += 0.02;
    buyersList.mesh.userData.core.scale.setScalar(1 + Math.sin(elapsed * 2.4) * 0.1);
  }

  function updateMovement(dt) {
    let turn = 0;
    if (keys.left) turn += 1;
    if (keys.right) turn -= 1;
    walker.turn(turn * TURN_SPEED * dt);

    let speed = 0;
    let anim = 'Idle';
    if (keys.up) {
      speed = keys.shift ? RUN_SPEED : WALK_SPEED;
      anim = keys.shift ? 'Run' : 'Walk';
    } else if (keys.down) {
      speed = -BACKWARD_SPEED;
      anim = 'Walk';
    }

    const prevNormal = walker.normal.clone();
    const prevForward = walker.forward.clone();
    walker.moveForward(speed * dt, PLANET_RADIUS);
    if (hitsObstacle(walker.normal, obstacles) || hitsObstacle(walker.normal, alienObstacles)) {
      walker.normal.copy(prevNormal);
      walker.forward.copy(prevForward);
    }

    if (consumeJumpPress() && jumpHeight <= 0) {
      jumpVelocity = JUMP_SPEED;
    }
    jumpVelocity -= GRAVITY * dt;
    jumpHeight += jumpVelocity * dt;
    if (jumpHeight < 0) {
      jumpHeight = 0;
      jumpVelocity = 0;
    }

    const newPos = walker.getPosition(PLANET_RADIUS);
    astronaut.object3D.position.copy(newPos).addScaledVector(walker.normal, jumpHeight);
    const orientQuat = walker.getOrientationQuaternion();
    if (astronaut.modelForwardOffset) {
      orientQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), astronaut.modelForwardOffset));
    }
    astronaut.object3D.quaternion.copy(orientQuat);
    if (jumpHeight > 0) {
      astronaut.fadeTo('Run', { duration: 0.12 });
      const squashT = Math.min(1, jumpHeight / JUMP_SQUASH_REFERENCE);
      astronaut.object3D.scale.y = 1 - JUMP_SQUASH_AMOUNT * squashT;
    } else {
      astronaut.fadeTo(anim, { duration: 0.2 });
      astronaut.object3D.scale.y = 1;
    }
  }

  function updateCamera(dt, camera) {
    const pos = walker.getPosition(PLANET_RADIUS);
    const camTarget = pos.clone()
      .addScaledVector(walker.forward, -CAM_DISTANCE)
      .addScaledVector(walker.normal, CAM_HEIGHT);
    if (snapCameraNext) {
      camera.position.copy(camTarget);
      snapCameraNext = false;
    } else {
      camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt));
    }
    camera.up.copy(walker.normal);
    const lookTarget = pos.clone().addScaledVector(walker.normal, LOOK_HEIGHT);
    camera.lookAt(lookTarget);
  }

  function updateShadowLight() {
    const pos = walker.getPosition(PLANET_RADIUS);
    sun.position.copy(pos).add(shadowLightOffset);
    sun.target.position.copy(pos);
  }

  function updateClouds(dt, elapsed) {
    cloudLayer.rotation.y += dt * 0.03;
    cloudLayer.rotation.x += dt * 0.007;
    highCloudLayer.rotation.y += dt * 0.014;
    highCloudLayer.rotation.z += dt * 0.005;

    for (const cloud of cloudLayer.userData.clouds) {
      const { mat, pulsePhase, pulseSpeed } = cloud.userData;
      mat.emissiveIntensity = 0.45 + Math.sin(elapsed * pulseSpeed + pulsePhase) * 0.35;
    }
    for (const cloud of highCloudLayer.userData.clouds) {
      const { mat, baseOpacity, pulsePhase, pulseSpeed } = cloud.userData;
      mat.opacity = baseOpacity + Math.sin(elapsed * pulseSpeed + pulsePhase) * 0.15;
    }
  }

  function updateAliens(dt, elapsed) {
    for (const alien of aliens) {
      alienWalkPosition(alien, elapsed, alienOrbitTarget);
      stepAvoidingObstacles(alien.groundPos, alienOrbitTarget, ALIEN_WALK_SPEED * dt, obstacles, ALIEN_BODY_RADIUS);

      const up = alienUpTemp.copy(alien.groundPos).normalize();
      // Whole-body bob rather than animating any sub-part of the model —
      // reads as walking without risking misidentified "legs". Recomputed
      // from groundPos every frame (not accumulated into mesh.position) —
      // see the note where groundPos is created.
      // Toned way down from an earlier 0.15 — that was subtle from a
      // distance but reads as a hard "bounce" up close, since the same
      // world-space bob amplitude fills far more of the screen the closer
      // the camera gets (i.e. exactly when the player is near enough to
      // actually be "hitting" one).
      const gait = elapsed * 3 + alien.walkPhase;
      alien.mesh.position.copy(alien.groundPos).addScaledVector(up, Math.abs(Math.sin(gait)) * 0.04);

      // facingQuaternion(), not mesh.up + mesh.lookAt() — the aliens looked
      // right when statically placed (orientToNormal's basis math) and
      // wrong once walking switched to lookAt() for this particular model,
      // so this reuses the same basis construction, driven by the actual
      // direction of travel instead of a fixed hint.
      const forward = alienForwardTemp.subVectors(alienOrbitTarget, alien.groundPos);
      if (forward.lengthSq() > 1e-8) {
        forward.normalize();
        alien.mesh.quaternion.copy(facingQuaternion(up, forward));
      }
    }
  }

  function updateComputers(dt, elapsed) {
    for (const c of computers) {
      const height = COMPUTER_HOVER_HEIGHT + Math.sin(elapsed * 0.8 + c.phase) * COMPUTER_BOB_AMOUNT;
      c.mesh.position.copy(c.spot).multiplyScalar(PLANET_RADIUS + height);
      c.mesh.rotateY(dt * 0.4);

      // Hidden once solved — the minimap picks up the job of marking it
      // from then on (see updateMinimap), so the in-world "find me" cue
      // isn't needed anymore.
      c.arrow.visible = !c.solved;
      if (!c.solved) {
        const arrowHeight = height + COMPUTER_ARROW_HEIGHT
          + Math.sin(elapsed * 2.2 + c.phase) * COMPUTER_ARROW_BOB_AMOUNT;
        c.arrow.position.copy(c.spot).multiplyScalar(PLANET_RADIUS + arrowHeight);
        orientToNormal(c.arrow, c.spot, elapsed * 1.4);
      }
    }
  }

  function updateMinimap() {
    const right = new THREE.Vector3().crossVectors(walker.normal, walker.forward).normalize();
    const blips = [];

    function addBlip(normal, color, size, shape) {
      const arc = PLANET_RADIUS * walker.normal.angleTo(normal);
      const toTarget = normal.clone().sub(walker.normal.clone().multiplyScalar(walker.normal.dot(normal)));
      if (toTarget.lengthSq() < 1e-8) {
        blips.push({ dx: 0, dy: 0, color, size, shape });
        return;
      }
      toTarget.normalize();
      blips.push({ dx: toTarget.dot(right) * arc, dy: toTarget.dot(walker.forward) * arc, color, size, shape });
    }

    // Computers and the ship are meant to be found by exploring, not read
    // off the radar — but once a computer's puzzle is solved, it's no
    // longer a "find it" objective, so it starts showing up as a landmark.
    for (const alien of aliens) addBlip(alien.groundPos.clone().normalize(), '#4affd8', 4, 'drone');
    for (const computer of computers) if (computer.solved) addBlip(computer.spot, '#7bffb0', 5);
    if (buyersList && !buyersList.collected) addBlip(buyersList.spot, '#ff5ad0', 6, 'list');

    minimap.draw(blips);
  }

  return {
    scene,
    update(dt, elapsed, camera) {
      if (state === 'playing') {
        updateMovement(dt);
        updateInteract();
        updateRoll();
      }
      astronaut.update(dt);
      updateCamera(dt, camera);
      updateShadowLight();
      updateClouds(dt, elapsed);
      updateAliens(dt, elapsed);
      updateComputers(dt, elapsed);
      updateBuyersList(elapsed);
      updateMinimap();
    },
    destroy() {
      minimap.destroy();
    },
  };
}

// Only the lava trees bundle into groves — cluster centers clear of every
// fixed landmark, each seeding a batch of trees jittered within
// TREE_CLUSTER_RADIUS of it (individually re-checked against clear zones
// too, since jitter can push a point back into one even when the cluster
// center itself was clear).
async function scatterTrees(scene, obstacles) {
  const clusterCenters = fibonacciSphere(TREE_CLUSTER_COUNT).filter((c) => !inTreeClearZone(c));
  const tasks = [];
  for (const center of clusterCenters) {
    const { u, v } = tangentBasis(center);
    for (let i = 0; i < TREES_PER_CLUSTER; i++) {
      tasks.push((async () => {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * TREE_CLUSTER_RADIUS;
        const point = center.clone()
          .addScaledVector(u, (Math.cos(angle) * dist) / PLANET_RADIUS)
          .addScaledVector(v, (Math.sin(angle) * dist) / PLANET_RADIUS)
          .normalize();
        if (inTreeClearZone(point)) return;
        try {
          const [minH, maxH] = TREE_HEIGHT;
          const height = minH + Math.random() * (maxH - minH);
          const instance = await loadDecoration('/assets/fifth/alienLavaTree.glb', height);
          placeOnSurface(instance, point, EMBED.flora);
          orientToNormal(instance, point, Math.random() * Math.PI * 2);
          scene.add(instance);
          obstacles.push({ normal: point.clone(), radius: height * 0.18 });
        } catch (err) {
          console.error('Failed to place lava tree:', err);
        }
      })());
    }
  }
  await Promise.all(tasks);
}

// Everything except trees — spread evenly across the whole planet (not
// clustered), per explicit request, so it doesn't read as sparse patches
// with empty ground between them.
async function scatterOtherFlora(scene) {
  const totalWeight = OTHER_FLORA.reduce((s, d) => s + d.weight, 0);
  function pick() {
    let r = Math.random() * totalWeight;
    for (const d of OTHER_FLORA) {
      if (r < d.weight) return d;
      r -= d.weight;
    }
    return OTHER_FLORA[0];
  }

  const points = fibonacciSphere(OTHER_FLORA_COUNT);
  await Promise.all(points.map(async (point) => {
    if (inClearZone(point)) return;
    const def = pick();
    try {
      const [minH, maxH] = def.height;
      const height = minH + Math.random() * (maxH - minH);
      const instance = await loadDecoration(def.url, height);
      placeOnSurface(instance, point, def.embed ?? EMBED.flora);
      orientToNormal(instance, point, Math.random() * Math.PI * 2);
      scene.add(instance);
    } catch (err) {
      console.error(`Failed to place ${def.url}:`, err);
    }
  }));
}

// No dedicated grass asset — procedural, orange, rendered as a single
// InstancedMesh (every blade in one draw call) rather than one THREE.Mesh
// per blade, which at tens of thousands of blades would be tens of
// thousands of draw calls. Geometry translated so its base (not center)
// sits at local y=0, so scaling .y per-instance grows each blade up from
// the ground instead of from its middle.
const GRASS_BLADE_GEOMETRY = new THREE.ConeGeometry(0.028, 1, 5).translate(0, 0.5, 0);
const GRASS_BLADE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xd9622a, roughness: 0.85, metalness: 0 });

function scatterGrass(scene) {
  const patchCenters = fibonacciSphere(GRASS_PATCH_COUNT).filter((c) => !inClearZone(c));
  const tuftPoints = [];
  for (const center of patchCenters) {
    const { u, v } = tangentBasis(center);
    for (let i = 0; i < GRASS_PER_PATCH; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * GRASS_PATCH_RADIUS;
      const point = center.clone()
        .addScaledVector(u, (Math.cos(angle) * dist) / PLANET_RADIUS)
        .addScaledVector(v, (Math.sin(angle) * dist) / PLANET_RADIUS)
        .normalize();
      if (!inClearZone(point)) tuftPoints.push(point);
    }
  }

  // Blade count per tuft has to be known before InstancedMesh is
  // constructed (it's fixed-size), so it's precomputed here rather than
  // decided per-blade during placement below.
  const [minBlades, maxBlades] = GRASS_BLADES_PER_TUFT;
  const bladeCounts = tuftPoints.map(() => minBlades + Math.floor(Math.random() * (maxBlades - minBlades + 1)));
  const totalBlades = bladeCounts.reduce((sum, n) => sum + n, 0);

  const grassMesh = new THREE.InstancedMesh(GRASS_BLADE_GEOMETRY, GRASS_BLADE_MATERIAL, totalBlades);
  grassMesh.receiveShadow = true; // no castShadow — tens of thousands of blades casting isn't worth the cost

  const dummy = new THREE.Object3D();
  let instanceIndex = 0;
  tuftPoints.forEach((point, tuftIdx) => {
    const { u, v } = tangentBasis(point);
    for (let b = 0; b < bladeCounts[tuftIdx]; b++) {
      const offsetU = (Math.random() - 0.5) * 0.16;
      const offsetV = (Math.random() - 0.5) * 0.16;
      const bladePoint = point.clone()
        .addScaledVector(u, offsetU / PLANET_RADIUS)
        .addScaledVector(v, offsetV / PLANET_RADIUS)
        .normalize();
      orientToNormal(dummy, bladePoint, Math.random() * Math.PI * 2);
      dummy.position.copy(bladePoint).multiplyScalar(PLANET_RADIUS - 0.05);
      dummy.scale.set(1, 0.22 + Math.random() * 0.22, 1);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(instanceIndex, dummy.matrix);
      instanceIndex += 1;
    }
  });
  grassMesh.instanceMatrix.needsUpdate = true;
  scene.add(grassMesh);
}
