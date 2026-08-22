import * as THREE from 'three';
import { createStarfield, createSun } from '../entities.js';
import { loadAstronaut } from '../game/character.js';
import { loadDecoration, loadAnimatedDecoration } from '../game/models.js';
import {
  keys, consumeJumpPress, consumeInteractPress, consumeRollPress,
} from '../game/input.js';
import {
  hideHud, showOverlay, announceObjective, flashToast,
} from '../game/hud.js';
import { speak } from '../game/voice.js';
import { playMusicTheme, playAmbience } from '../game/audio.js';
import { createMinimap } from '../game/minimap.js';
import { storyFlags, FOURTH_CLIENT_FIRST_NAME } from '../game/storyFlags.js';
import { showSudokuPuzzle } from '../game/sudokuPuzzle.js';

// Smite Colony (new build) — public/assets/sixth/ used to hold a whole
// cyberpunk building kit (this level's original incarnation), but that's
// all been swapped out for a single new piece: a small drifting "space
// land" landmass. This level is built around THAT actually being the
// ground, not a sphere with the model floating decoratively overhead.
// That's a real departure from every other level here: planet.js's
// createPlanetWalker (great-circle movement driven by a surface *normal*)
// only makes sense on a true sphere, and this mesh is a small, irregular,
// flattish chunk — nothing about it is spherical. So instead of a planet
// radius, movement here is flat (world +Y is permanently "up") with the
// ground height at any (x,z) sampled by casting a ray straight down into
// the landmass mesh each frame — the same raycast-follow-the-terrain
// approach most third-person games use for uneven (non-sphere) ground.
// Walking off the mesh's edge (or into a gap between its three separate
// sub-meshes) just finds no hit, which blocks the move — an invisible edge
// around the whole landmass, since there's nowhere to fall to that means
// anything (it's a chunk floating in space). Not wired into the story/
// ending flow yet — dev-jumpable only, same stage every other level starts
// at.
const UP = new THREE.Vector3(0, 1, 0);

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

const PLAYER_COLLISION_RADIUS = 0.45;

// The one asset left in public/assets/sixth/ — scaled (via loadDecoration's
// usual "normalize to a target height, feet at local origin" convention) so
// its walkable footprint reads as a small explorable world rather than a
// prop. This particular file's source scene graph is an unusually deep,
// oddly-nested transform chain (Sketchfab export artifact — a tiny scale
// followed by a huge counter-scale a few nodes down), which made a
// hardcoded assumption of "footprint centered on (0,0), fits in a
// 28-unit-radius search, ship deck around y=0-40" wrong in a way that isn't
// obvious just from the raw accessor data — it silently found no ground
// anywhere. So none of that is hardcoded any more: the actual world-space
// bounding box is measured at runtime right after the model loads (see
// LANDMASS_SEARCH_MARGIN below), and every position/radius/ray-height
// derives from that measurement instead of a guess.
const LANDMASS_ASSET_PATH = '/assets/sixth/whimsical_cartoon_space_land_3d_model.glb';
const LANDMASS_TARGET_HEIGHT = 40;
const LANDMASS_SPAWN_SEARCH_RINGS = 8;
// Stay this far inside the measured edge when picking the search radius —
// the outermost sliver of the bounding box is disproportionately likely to
// be a thin, non-representative corner of the mesh rather than real
// walkable ground.
const LANDMASS_SEARCH_MARGIN = 3;

// MAX_GROUND_STEP caps how much the sampled ground height is allowed to
// jump between one frame's position and the next candidate — lets the
// player walk up real slopes but stops them teleporting up/down a sheer
// cliff face in a single step (treated as a wall instead).
const RAY_ABOVE_MARGIN = 20; // ray origin sits this far above the measured highest point
const RAY_BELOW_MARGIN = 40; // and reaches this far below the measured lowest point
const MAX_GROUND_STEP = 2.5;

const SHIP_BLOCK_RADIUS = 3.0;
const SHIP_INTERACT_RADIUS = 4.6;
const SHIP_EMBED = 0.5; // how far the ship's feet sink below the sampled ground point, same idea as every other level's EMBED

const LANDING_PAD_RADIUS = SHIP_BLOCK_RADIUS;
const LANDING_PAD_HEIGHT = 0.4;

// A handful of small alien huts scattered across the landmass — built from
// primitives (cone roof + squat cylinder body + a glowing doorway disc),
// same general technique as createLandingPad above, rather than the
// shared house.glb every other level's human villages use — that model
// reads as a human-scale building, way too big for a hut here. Solid,
// player-only, same reasoning as ALIEN_BODY_RADIUS above.
const ALIEN_HUT_RADIUS = 0.9;
const ALIEN_HUT_BODY_HEIGHT = 0.9;
const ALIEN_HUT_ROOF_HEIGHT = 0.8;
const ALIEN_HUT_EMBED = 0.1;
const ALIEN_HUT_COUNT = 5;
const ALIEN_HUT_MIN_SPACING = ALIEN_HUT_RADIUS * 3.5;
const ALIEN_HUT_PLACEMENT_ATTEMPTS = 30;

// Soft, grayscale-leaning cloud puffs (keeps the "gray sky" request intact
// rather than fighting it with a rainbow nebula) built as camera-facing
// sprites, not a texture painted on scene.background or a fixed-orientation
// mesh — a flat backdrop texture doesn't rotate with the camera and would
// look pasted-on the moment the player turns; sprites always face the
// camera, so they read as actual clouds sitting out in 3D space no matter
// which way you're looking.
const NEBULA_COLOR_STOPS = [
  ['rgba(150,150,162,0.55)', 'rgba(90,90,102,0.22)'],
  ['rgba(140,150,172,0.5)', 'rgba(80,90,112,0.2)'],
  ['rgba(162,142,152,0.45)', 'rgba(92,80,92,0.18)'],
];
const NEBULA_PUFF_COUNT = 16;
const NEBULA_SPREAD = 850; // just inside the starfield's own 900-unit spread, so puffs sit among the stars rather than past them
const NEBULA_PUFF_SCALE_RANGE = [320, 720];

function createNebulaPuffTexture(innerColor, outerColor) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.55, outerColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function createNebula() {
  const group = new THREE.Group();
  for (let i = 0; i < NEBULA_PUFF_COUNT; i++) {
    const [inner, outer] = NEBULA_COLOR_STOPS[Math.floor(Math.random() * NEBULA_COLOR_STOPS.length)];
    const mat = new THREE.SpriteMaterial({
      map: createNebulaPuffTexture(inner, outer),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    sprite.position.copy(dir).multiplyScalar(NEBULA_SPREAD * (0.7 + Math.random() * 0.3));
    const scale = NEBULA_PUFF_SCALE_RANGE[0] + Math.random() * (NEBULA_PUFF_SCALE_RANGE[1] - NEBULA_PUFF_SCALE_RANGE[0]);
    sprite.scale.set(scale, scale, 1);
    group.add(sprite);
  }
  return group;
}

// Ash blanketing one half of the landmass — flattened, ground-hugging puffs
// (unlike the nebula's glowing additive space-clouds, these use ordinary
// alpha blending and stay subject to the scene's fog, since they're meant
// to read as settled dust/soot sitting ON the terrain, not light in the
// sky) scattered only across x < centerX, sampled onto the real terrain
// height via the same sampleGroundY the player's own footing uses, so the
// coverage actually hugs the ground's slopes instead of floating over them.
const ASH_COLOR_STOPS = [
  ['rgba(118,110,98,0.6)', 'rgba(70,64,56,0)'],
  ['rgba(138,128,112,0.55)', 'rgba(80,74,64,0)'],
];
const ASH_PUFF_COUNT = 70;
const ASH_PUFF_SCALE_RANGE = [7, 15];
const ASH_HOVER_HEIGHT = 0.5;
const ASH_MAX_PLACEMENT_ATTEMPTS_PER_PUFF = 8;

function scatterAsh(centerX, centerZ, halfWidthX, depthZ, sampleGroundY) {
  const group = new THREE.Group();
  let placed = 0;
  let attempts = 0;
  const maxAttempts = ASH_PUFF_COUNT * ASH_MAX_PLACEMENT_ATTEMPTS_PER_PUFF;
  while (placed < ASH_PUFF_COUNT && attempts < maxAttempts) {
    attempts += 1;
    const x = centerX - Math.random() * halfWidthX; // only the x < centerX half
    const z = centerZ + (Math.random() * 2 - 1) * (depthZ / 2);
    const y = sampleGroundY(x, z);
    if (y === null) continue;
    const [inner, outer] = ASH_COLOR_STOPS[Math.floor(Math.random() * ASH_COLOR_STOPS.length)];
    const mat = new THREE.SpriteMaterial({
      map: createNebulaPuffTexture(inner, outer),
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + ASH_HOVER_HEIGHT, z);
    const scale = ASH_PUFF_SCALE_RANGE[0] + Math.random() * (ASH_PUFF_SCALE_RANGE[1] - ASH_PUFF_SCALE_RANGE[0]);
    sprite.scale.set(scale, scale * 0.5, 1); // flattened toward the ground rather than a round puff
    group.add(sprite);
    placed += 1;
  }
  return group;
}

// A few Quaternius aliens (the sixth folder's other new addition) wandering
// the landmass — same sampleGroundY the player uses, so they stay glued to
// the terrain rather than sliding around on a flat assumed plane. "Logical
// movement" here means a simple wander loop, not scripted patrol routes:
// idle for a while, pick a random nearby point that's actually ground (and
// not the ship pad), walk to it facing the direction of travel, idle again,
// repeat. Clip names come off the source file as `AlienArmature|Alien_X` —
// loadAnimatedDecoration's `clip.name.split('|')[1]` convention resolves
// that to plain `Alien_X`, e.g. `Alien_Walk` / `Alien_Idle` used below.
const ALIEN_ASSET_PATH = '/assets/sixth/Alien%20by%20Quaternius%20-%20HYUUkdugoP.glb';
const ALIEN_HEIGHT = 1.7;
const ALIEN_COUNT = 5;
const ALIEN_WALK_SPEED = 1.6;
const ALIEN_WANDER_RADIUS = 16; // how far a wandering alien picks its next destination
const ALIEN_ARRIVE_DIST = 0.4;
const ALIEN_IDLE_MIN_MS = 1500;
const ALIEN_IDLE_MAX_MS = 4500;
const ALIEN_PLACEMENT_SEARCH_ATTEMPTS = 24;
const ALIEN_WANDER_SEARCH_ATTEMPTS = 8;
// Keep wandering aliens off the landing pad/ship footprint.
const ALIEN_SHIP_AVOID_RADIUS = SHIP_BLOCK_RADIUS + 4;
// Keep aliens (placement, wandering, and fleeing alike) well inside the
// landmass's already-conservative search radius — a fleeing alien would
// otherwise happily run itself right up to (or past) the edge.
const ALIEN_SAFE_RADIUS_FRACTION = 0.7;

// The actual game the aliens are here for: get within ALIEN_FLEE_TRIGGER_
// RADIUS of an idle/wandering one and it bolts, running directly away from
// the player (with a hysteresis gap before ALIEN_FLEE_CALM_RADIUS, so it
// doesn't flicker in and out of fleeing right at the trigger edge). Flee
// speed sits below the player's RUN_SPEED on purpose — an alien is only
// catchable with a sustained chase, not a single lucky step. Catching one
// is just reaching it (no separate button), which reads as "run it down."
const ALIEN_FLEE_TRIGGER_RADIUS = 7;
const ALIEN_FLEE_CALM_RADIUS = 11;
const ALIEN_FLEE_SPEED = 3.8;
const ALIEN_CATCH_RADIUS = 1.1;
// Tried in order when fleeing directly away from the player finds no
// ground (edge of the mesh, or a gap between its sub-meshes) — increasingly
// sideways/backward angles off the "directly away" heading, so a cornered
// alien keeps looking for *some* way out before it's well and truly stuck
// (which is exactly what makes it catchable).
const ALIEN_FLEE_ANGLE_STEPS = [0, 45, -45, 90, -90, 135, -135];
// Aliens are solid — the player can't just walk through one — but this has
// to stay smaller than ALIEN_CATCH_RADIUS (accounting for the player's own
// PLAYER_COLLISION_RADIUS padding) or the collision itself would stop the
// player just outside catching range and a catch could never trigger.
const ALIEN_BODY_RADIUS = 0.6;
// Whichever alien is left uncaught last doesn't flee or get auto-caught by
// touch at all — once only one remains, it calms down and waits, and has
// to be walked up to and talked to (E), same as the ship.
const ALIEN_TALK_RADIUS = 2.6;

// Picks a random point within `radius` of (cx, cz) that actually samples as
// ground (retrying a handful of times, since the landmass isn't a solid
// disc), optionally rejecting points too close to an `avoid` circle, and
// optionally requiring the point stay within a separate `centerLimit`
// circle (used to keep aliens away from the landmass edge even when the
// search itself is centered on the alien's own position, not the map's).
function randomGroundSpotNear(cx, cz, radius, attempts, sampleGroundY, avoid, centerLimit) {
  for (let i = 0; i < attempts; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius;
    const x = cx + Math.cos(angle) * dist;
    const z = cz + Math.sin(angle) * dist;
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < avoid.radius) continue;
    if (centerLimit && Math.hypot(x - centerLimit.x, z - centerLimit.z) > centerLimit.radius) continue;
    const y = sampleGroundY(x, z);
    if (y !== null) return { x, y, z };
  }
  return null;
}

function rotateXZ(x, z, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [x * cos - z * sin, x * sin + z * cos];
}

function createLandingPad() {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.5, roughness: 0.5 });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(LANDING_PAD_RADIUS, LANDING_PAD_RADIUS * 1.08, LANDING_PAD_HEIGHT, 28),
    baseMat,
  );
  base.position.y = LANDING_PAD_HEIGHT / 2;
  base.receiveShadow = true;
  group.add(base);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x2ad0ff, emissive: 0x0c4a5c, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(LANDING_PAD_RADIUS * 0.75, 0.1, 10, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = LANDING_PAD_HEIGHT + 0.02;
  group.add(ring);

  return group;
}

// A small alien-scale hut: squat cylinder body, cone roof, glowing round
// doorway — built entirely from primitives (no glb) precisely so it can be
// sized however small this world actually calls for, rather than inheriting
// house.glb's human-village proportions.
function createAlienHut() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 0.85, metalness: 0.05 });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(ALIEN_HUT_RADIUS * 0.85, ALIEN_HUT_RADIUS, ALIEN_HUT_BODY_HEIGHT, 10),
    bodyMat,
  );
  body.position.y = ALIEN_HUT_BODY_HEIGHT / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a3d30, roughness: 0.7 });
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(ALIEN_HUT_RADIUS * 1.05, ALIEN_HUT_ROOF_HEIGHT, 10),
    roofMat,
  );
  roof.position.y = ALIEN_HUT_BODY_HEIGHT + ALIEN_HUT_ROOF_HEIGHT / 2 - 0.05;
  roof.castShadow = true;
  group.add(roof);

  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x2ad0ff, emissive: 0x0c4a5c, emissiveIntensity: 0.9, side: THREE.DoubleSide,
  });
  const door = new THREE.Mesh(new THREE.CircleGeometry(ALIEN_HUT_RADIUS * 0.28, 12), doorMat);
  door.position.set(0, ALIEN_HUT_RADIUS * 0.55, ALIEN_HUT_RADIUS * 0.84);
  group.add(door);

  return group;
}

export async function createSmiteColonyScene({ onComplete } = {}) {
  hideHud();
  playMusicTheme('client'); // placeholder theme until this level gets its own
  playAmbience('client');

  const scene = new THREE.Scene();
  // A dark (not light) gray for the backdrop itself — deep space still
  // needs to be dark enough for the starfield/nebula (both fog:false, so
  // this color is the only thing they're ever seen against) to actually
  // read; the "gray sky" request is carried by the fog instead, which
  // gives the ground/near-camera haze a gray, overcast look without
  // washing out everything behind it.
  scene.background = new THREE.Color(0x26262c);
  scene.fog = new THREE.Fog(0x8c8c8c, 90, 260);
  scene.add(new THREE.AmbientLight(0x8a8a8a, 0.8));
  // The primary sun — the only one that actually casts shadows (three
  // full shadow-casting DirectionalLights would be needlessly expensive,
  // and three overlapping shadow directions would just look muddy anyway).
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.4);
  sun.position.set(-50, 70, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(sun.target);

  const sunGlow = createSun(0xffb060, 3);
  sunGlow.position.set(-320, 220, 160);
  scene.add(sunGlow);

  // Two more suns — visual glow plus a modest non-shadow fill light each,
  // so the extra light sources are actually felt, not just decorative.
  const sun2 = new THREE.DirectionalLight(0xbfe0ff, 0.6);
  sun2.position.set(60, 50, -30);
  scene.add(sun2);
  scene.add(sun2.target);
  const sun2Glow = createSun(0xbfe0ff, 2.4);
  sun2Glow.position.set(260, 150, -220);
  scene.add(sun2Glow);

  const sun3 = new THREE.DirectionalLight(0xffd0a0, 0.5);
  sun3.position.set(10, -60, 80);
  scene.add(sun3);
  scene.add(sun3.target);
  const sun3Glow = createSun(0xffd0a0, 2.0);
  sun3Glow.position.set(50, -260, 300);
  scene.add(sun3Glow);

  const stars = createStarfield(2400, 900, true);
  // Stars sit 450-900 units out, but scene.fog only reaches 260 — without
  // this they'd be fully fogged out to the fog color and invisible.
  stars.material.fog = false;
  // Bigger than createStarfield's shared default (1.4) — overridden here
  // rather than in entities.js so every other level's starfield is
  // untouched.
  stars.material.size = 4;
  scene.add(stars);

  const nebula = createNebula();
  scene.add(nebula);

  // The actual ground — a raycast target, not decoration. Placed at the
  // world origin; its real footprint/height is measured below rather than
  // assumed (see the comment on LANDMASS_ASSET_PATH above for why).
  const landmass = await loadDecoration(LANDMASS_ASSET_PATH, LANDMASS_TARGET_HEIGHT);
  landmass.position.set(0, 0, 0);
  landmass.updateMatrixWorld(true);
  landmass.traverse((node) => {
    if (node.isMesh) node.receiveShadow = true;
  });
  scene.add(landmass);

  const landmassBox = new THREE.Box3().setFromObject(landmass);
  const landmassCenter = landmassBox.getCenter(new THREE.Vector3());
  const landmassSize = landmassBox.getSize(new THREE.Vector3());
  const rayOriginHeight = landmassBox.max.y + RAY_ABOVE_MARGIN;
  const raySpan = landmassSize.y + RAY_ABOVE_MARGIN + RAY_BELOW_MARGIN;
  const landmassSearchRadius = Math.max(1, Math.max(landmassSize.x, landmassSize.z) / 2 - LANDMASS_SEARCH_MARGIN);

  const raycaster = new THREE.Raycaster();
  raycaster.far = raySpan;
  const DOWN = new THREE.Vector3(0, -1, 0);
  // Returns the landmass surface height at (x,z), or null if there's no
  // ground there at all (off the edge, or in a gap between its three
  // separate sub-meshes).
  function sampleGroundY(x, z) {
    raycaster.set(new THREE.Vector3(x, rayOriginHeight, z), DOWN);
    const hits = raycaster.intersectObject(landmass, true);
    return hits.length > 0 ? hits[0].point.y : null;
  }

  // Tries the exact center first, then spirals outward in rings looking for
  // any point that actually hits ground — the mesh isn't guaranteed
  // watertight/convex (three separate sub-meshes), so the center alone
  // isn't a safe bet.
  function findGroundSpot(centerX, centerZ, searchRadius, rings) {
    const candidates = [[centerX, centerZ]];
    for (let ring = 1; ring <= rings; ring++) {
      const r = (ring / rings) * searchRadius;
      const pointsOnRing = 4 + ring * 4;
      for (let i = 0; i < pointsOnRing; i++) {
        const angle = (i / pointsOnRing) * Math.PI * 2;
        candidates.push([centerX + Math.cos(angle) * r, centerZ + Math.sin(angle) * r]);
      }
    }
    for (const [x, z] of candidates) {
      const y = sampleGroundY(x, z);
      if (y !== null) return { x, y, z };
    }
    return null;
  }

  // This particular landmass turned out not to be "flat ground plus a few
  // tall features" — it's one continuous slope spanning its entire ~40-unit
  // height range (measured: full range 0-40, median sample only slightly
  // below the 90th percentile). findGroundSpot's old "first hit spiraling
  // out from the exact geometric center" landed the ship near the summit of
  // that slope for this model, stranding it (and the player, spawned next
  // to it) high up with almost the whole rest of the map an unreachable
  // MAX_GROUND_STEP-busting drop away in every direction.
  //
  // This grid-samples the whole search area on a `gridStep` lattice and
  // only considers a point a candidate "clearing" if every immediate
  // lattice neighbor is within `maxLocalStep` of it — i.e. the exact same
  // per-step climb limit updateMovement enforces, so a spot this returns is
  // provably walkable away from in every direction, not just plausible-
  // looking. Among those, it picks whichever sits closest to the terrain's
  // *median* height (representative elevation, not a fluke low pocket). If
  // nothing on the whole map is that flat, it falls back to whatever single
  // point IS flattest overall — being able to move at all beats sitting at
  // a "correct" elevation.
  function findClearingSpot(centerX, centerZ, searchRadius, gridStep, maxLocalStep) {
    const cellKey = (x, z) => `${Math.round(x / gridStep)},${Math.round(z / gridStep)}`;
    const sampleMap = new Map();
    for (let x = centerX - searchRadius; x <= centerX + searchRadius; x += gridStep) {
      for (let z = centerZ - searchRadius; z <= centerZ + searchRadius; z += gridStep) {
        if (Math.hypot(x - centerX, z - centerZ) > searchRadius) continue;
        const y = sampleGroundY(x, z);
        if (y !== null) sampleMap.set(cellKey(x, z), { x, y, z });
      }
    }
    const samples = [...sampleMap.values()];
    if (samples.length === 0) return null;

    function localFlatness(s) {
      const offsets = [[gridStep, 0], [-gridStep, 0], [0, gridStep], [0, -gridStep]];
      let maxDiff = 0;
      for (const [dx, dz] of offsets) {
        const neighbor = sampleMap.get(cellKey(s.x + dx, s.z + dz));
        if (!neighbor) return Infinity; // edge of the mesh right next door — not a clearing
        maxDiff = Math.max(maxDiff, Math.abs(neighbor.y - s.y));
      }
      return maxDiff;
    }

    const sortedY = samples.map((s) => s.y).sort((a, b) => a - b);
    const medianY = sortedY[Math.floor(sortedY.length / 2)];
    let best = null;
    let bestScore = Infinity;
    let flattest = samples[0];
    let flattestScore = Infinity;
    for (const s of samples) {
      const flatness = localFlatness(s);
      if (flatness < flattestScore) { flattestScore = flatness; flattest = s; }
      if (flatness > maxLocalStep) continue;
      const score = Math.abs(s.y - medianY);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best ?? flattest;
  }

  const shipSpot = findClearingSpot(landmassCenter.x, landmassCenter.z, landmassSearchRadius, 2, MAX_GROUND_STEP)
    ?? findGroundSpot(landmassCenter.x, landmassCenter.z, landmassSearchRadius, LANDMASS_SPAWN_SEARCH_RINGS);
  if (!shipSpot) {
    throw new Error(`No ground found on the landmass (measured size ${landmassSize.x.toFixed(1)}x${landmassSize.y.toFixed(1)}x${landmassSize.z.toFixed(1)}, searched radius ${landmassSearchRadius.toFixed(1)} around (${landmassCenter.x.toFixed(1)}, ${landmassCenter.z.toFixed(1)})).`);
  }

  const ash = scatterAsh(landmassCenter.x, landmassCenter.z, landmassSize.x / 2, landmassSize.z, sampleGroundY);
  scene.add(ash);

  const shipAvoid = { x: shipSpot.x, z: shipSpot.z, radius: ALIEN_SHIP_AVOID_RADIUS };
  const alienSafeRadius = landmassSearchRadius * ALIEN_SAFE_RADIUS_FRACTION;
  const alienSafeZone = { x: landmassCenter.x, z: landmassCenter.z, radius: alienSafeRadius };
  const aliens = [];
  for (let i = 0; i < ALIEN_COUNT; i++) {
    const spot = randomGroundSpotNear(
      landmassCenter.x, landmassCenter.z, alienSafeRadius,
      ALIEN_PLACEMENT_SEARCH_ATTEMPTS, sampleGroundY, shipAvoid,
    );
    if (!spot) continue;
    // eslint-disable-next-line no-await-in-loop -- small fixed count, sequential load is fine
    const alien = await loadAnimatedDecoration(ALIEN_ASSET_PATH, ALIEN_HEIGHT);
    alien.object3D.position.set(spot.x, spot.y, spot.z);
    scene.add(alien.object3D);
    alien.fadeTo('Alien_Idle', { duration: 0 });
    aliens.push({
      ...alien,
      pos: new THREE.Vector3(spot.x, spot.y, spot.z),
      mode: 'idle',
      caught: false,
      idleRemaining: 400 + Math.random() * 2200,
      targetX: spot.x,
      targetZ: spot.z,
    });
  }

  function isBlockedByAlien(x, z) {
    for (const alien of aliens) {
      if (Math.hypot(x - alien.pos.x, z - alien.pos.z) < ALIEN_BODY_RADIUS + PLAYER_COLLISION_RADIUS) return true;
    }
    return false;
  }

  // Huts, scattered the same way as the aliens (avoiding the ship, kept off
  // the landmass edge), but also spaced apart from each other so they don't
  // overlap or crowd into one clump. Built (createAlienHut), not loaded —
  // no await needed, unlike the old house.glb version.
  const alienHutColliders = [];
  for (let i = 0; i < ALIEN_HUT_COUNT; i++) {
    let spot = null;
    for (let attempt = 0; attempt < ALIEN_HUT_PLACEMENT_ATTEMPTS && !spot; attempt++) {
      const candidate = randomGroundSpotNear(
        landmassCenter.x, landmassCenter.z, alienSafeRadius, 1, sampleGroundY, shipAvoid,
      );
      if (!candidate) continue;
      const tooClose = alienHutColliders.some(
        (c) => Math.hypot(candidate.x - c.x, candidate.z - c.z) < ALIEN_HUT_MIN_SPACING,
      );
      if (!tooClose) spot = candidate;
    }
    if (!spot) continue;
    const hut = createAlienHut();
    hut.position.set(spot.x, spot.y - ALIEN_HUT_EMBED, spot.z);
    hut.rotation.y = Math.random() * Math.PI * 2;
    scene.add(hut);
    alienHutColliders.push({ x: spot.x, z: spot.z, radius: ALIEN_HUT_RADIUS });
  }

  function isBlockedByHut(x, z) {
    return alienHutColliders.some(
      (c) => Math.hypot(x - c.x, z - c.z) < c.radius + PLAYER_COLLISION_RADIUS,
    );
  }

  let caughtCount = 0;
  let talkTargetAlien = null;
  // The ship won't leave until the last alien's actually been talked to —
  // set by handleAlienTalk, checked by handleShipInteract below.
  let missionComplete = false;

  // Catching one is just a beat, not an end state — it claps briefly, then
  // goes right back to its normal idle/wander loop (just permanently done
  // fleeing/re-catching, via the `caught` flag below), same as before it
  // was ever spooked. Once only one alien is left uncaught, though, it
  // becomes the talk target instead (see handleAlienTalk below) — it never
  // goes through this touch-catch path at all.
  function catchAlien(alien) {
    alien.caught = true;
    alien.mode = 'caughtReaction';
    alien.reactionRemaining = 900;
    alien.fadeTo('Alien_Clapping', { duration: 0.2 });
    caughtCount += 1;
    if (caughtCount < aliens.length) {
      announce(`Caught! ${caughtCount}/${aliens.length} aliens.`);
    }
    if (!talkTargetAlien && caughtCount === aliens.length - 1) {
      talkTargetAlien = aliens.find((a) => !a.caught) ?? null;
      if (talkTargetAlien) {
        talkTargetAlien.mode = 'awaitingTalk';
        talkTargetAlien.fadeTo('Alien_Standing', { duration: 0.3 });
        announce('...One of them isn\'t running. Corthana: "That one\'s different — go talk to it."');
      }
    }
  }

  function revealFourthClientName() {
    storyFlags.fourthClientFirstName = FOURTH_CLIENT_FIRST_NAME;
    // The alien itself "speaks" this part — same floating bubble widget
    // Corthana uses (not the blocking showOverlay modal, so movement never
    // pauses for it), but with her face/name swapped out, since this line
    // isn't actually her. Corthana gets her own normal, face-on bubble
    // right after, reacting to it.
    announceObjective(
      `${FOURTH_CLIENT_FIRST_NAME}... that's all that comes through clean.`,
      { name: 'GARBLED SIGNAL', iconSrc: null },
    );
    setTimeout(() => {
      announce(
        `Corthana: "${FOURTH_CLIENT_FIRST_NAME}. First name, probably — that's all it gave up. Feed it back to `
        + 'the buyer\'s list once we\'re off this rock."',
      );
    }, 3200);
  }

  // Tries to keep fleeing directly away from the player; if that heading has
  // no ground (edge of the mesh, a gap between sub-meshes, too high/low to
  // be walkable, or outside alienSafeZone) it walks the angle outward
  // through ALIEN_FLEE_ANGLE_STEPS looking for any direction that clears
  // all of that — which also means an alien already near the landmass edge
  // refuses to flee further out, rather than running itself off the map.
  // Leaves the alien in place (an easy catch) if truly cornered.
  function fleeStep(alien, dt, awayX, awayZ, awayDist) {
    const dirX = awayDist > 0.0001 ? awayX / awayDist : 1;
    const dirZ = awayDist > 0.0001 ? awayZ / awayDist : 0;
    for (const angle of ALIEN_FLEE_ANGLE_STEPS) {
      const [cx, cz] = rotateXZ(dirX, dirZ, angle);
      const nx = alien.pos.x + cx * ALIEN_FLEE_SPEED * dt;
      const nz = alien.pos.z + cz * ALIEN_FLEE_SPEED * dt;
      if (Math.hypot(nx - alienSafeZone.x, nz - alienSafeZone.z) > alienSafeZone.radius) continue;
      const ny = sampleGroundY(nx, nz);
      if (ny !== null) {
        alien.object3D.lookAt(nx, ny, nz);
        alien.pos.set(nx, ny, nz);
        return;
      }
    }
  }

  function updateAliens(dt) {
    for (const alien of aliens) {
      if (alien.mode === 'caughtReaction') {
        alien.reactionRemaining -= dt * 1000;
        if (alien.reactionRemaining <= 0) {
          alien.mode = 'idle';
          alien.idleRemaining = 200 + Math.random() * 800;
          alien.fadeTo('Alien_Idle', { duration: 0.3 });
        }
        alien.object3D.position.copy(alien.pos);
        alien.update(dt);
        continue;
      }

      // The talk target just stands there, calm, waiting for E — it never
      // flees or gets auto-caught by touch (see catchAlien/handleAlienTalk).
      if (alien.mode === 'awaitingTalk') {
        alien.object3D.position.copy(alien.pos);
        alien.update(dt);
        continue;
      }

      const awayX = alien.pos.x - playerPos.x;
      const awayZ = alien.pos.z - playerPos.z;
      const distToPlayer = Math.hypot(awayX, awayZ);

      if (!alien.caught) {
        if (distToPlayer <= ALIEN_CATCH_RADIUS) {
          catchAlien(alien);
          alien.object3D.position.copy(alien.pos);
          alien.update(dt);
          continue;
        }
        if (alien.mode !== 'fleeing' && distToPlayer <= ALIEN_FLEE_TRIGGER_RADIUS) {
          alien.mode = 'fleeing';
          alien.fadeTo('Alien_Run', { duration: 0.15 });
        }
      }

      if (alien.mode === 'fleeing') {
        if (distToPlayer > ALIEN_FLEE_CALM_RADIUS) {
          alien.mode = 'idle';
          alien.idleRemaining = 300 + Math.random() * 800;
          alien.fadeTo('Alien_Idle', { duration: 0.3 });
        } else {
          fleeStep(alien, dt, awayX, awayZ, distToPlayer);
        }
      } else if (alien.mode === 'idle') {
        alien.idleRemaining -= dt * 1000;
        if (alien.idleRemaining <= 0) {
          const next = randomGroundSpotNear(
            alien.pos.x, alien.pos.z, ALIEN_WANDER_RADIUS,
            ALIEN_WANDER_SEARCH_ATTEMPTS, sampleGroundY, shipAvoid, alienSafeZone,
          );
          if (next) {
            alien.targetX = next.x;
            alien.targetZ = next.z;
            alien.mode = 'walking';
            alien.fadeTo('Alien_Walk', { duration: 0.3 });
          } else {
            alien.idleRemaining = 600; // no valid spot this try — retry soon
          }
        }
      } else {
        const dx = alien.targetX - alien.pos.x;
        const dz = alien.targetZ - alien.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < ALIEN_ARRIVE_DIST) {
          alien.mode = 'idle';
          alien.idleRemaining = ALIEN_IDLE_MIN_MS + Math.random() * (ALIEN_IDLE_MAX_MS - ALIEN_IDLE_MIN_MS);
          alien.fadeTo('Alien_Idle', { duration: 0.3 });
        } else {
          const step = Math.min(dist, ALIEN_WALK_SPEED * dt);
          const nx = alien.pos.x + (dx / dist) * step;
          const nz = alien.pos.z + (dz / dist) * step;
          const ny = sampleGroundY(nx, nz);
          if (ny === null) {
            // walked off the edge of its own footing (mesh gap) — stop and re-pick
            alien.mode = 'idle';
            alien.idleRemaining = 300;
          } else {
            alien.object3D.lookAt(nx, ny, nz);
            alien.pos.set(nx, ny, nz);
          }
        }
      }
      alien.object3D.position.copy(alien.pos);
      alien.update(dt);
    }
  }

  const landingPad = createLandingPad();
  landingPad.position.set(shipSpot.x, shipSpot.y, shipSpot.z);
  scene.add(landingPad);

  const ship = await loadDecoration('/assets/spaceship.glb', 6.5);
  ship.position.set(shipSpot.x, shipSpot.y + LANDING_PAD_HEIGHT - SHIP_EMBED, shipSpot.z);
  scene.add(ship);

  const astronaut = await loadAstronaut();
  scene.add(astronaut.object3D);
  astronaut.fadeTo('Idle', { duration: 0 });
  let jumpVelocity = 0;
  let jumpHeight = 0;

  // Spawn a short walk from the ship rather than right on top of it — the
  // ship itself now sits in a genuine clearing (see findClearingSpot
  // above), so a small local ring search around it is enough.
  const spawnSpot = findGroundSpot(
    shipSpot.x + SHIP_BLOCK_RADIUS + 3, shipSpot.z, 6, 3,
  ) ?? shipSpot;
  const playerPos = new THREE.Vector3(spawnSpot.x, spawnSpot.y, spawnSpot.z);
  let groundY = spawnSpot.y;
  let yaw = Math.PI; // face back toward the ship at spawn

  const minimap = createMinimap();

  let snapCameraNext = true;
  let state = 'intro';

  function announce(text) {
    announceObjective(text);
    speak(text);
  }

  showOverlay(
    'Smite Colony',
    'Corthana: However this thing stays up, it isn\'t on any drive system I recognize. Small, though — you\'ll '
    + 'hit the edge fast if you go looking for one.\n\n'
    + 'Whatever those things are, they bolt the second you get close. Corthana: "...Try and catch one. All of '
    + 'them — we\'re not leaving until you do."\n\n'
    + 'W/↑: Walk   S/↓: Back   A/D: Turn   Shift: Run   Space: Jump   E: Interact',
    'Begin',
    () => {
      state = 'playing';
      snapCameraNext = true;
      announce('Objective: chase down the fleeing aliens, then return to the ship.');
    },
  );

  function updateRoll() {
    if (consumeRollPress()) astronaut.playFlourish('Roll', { duration: 0.1, returnDuration: 0.25 });
  }

  function handleShipInteract() {
    if (!missionComplete) {
      flashToast('Corthana: "Not yet — you can\'t leave until you\'ve finished here."', 2600);
      return;
    }
    astronaut.playFlourish('Interact');
    state = 'ending';
    showOverlay(
      'Departing',
      'Whatever this thing is, it isn\'t our buyer.\n\n'
      + 'Corthana: "Kaross Vey\'s trail ends here — one buyer down, three still out there. Let\'s keep moving."',
      'Depart',
      () => onComplete?.(),
    );
  }

  function handleAlienTalk() {
    if (!talkTargetAlien || talkTargetAlien.caught) return;
    // Same movement-lock the buyer's-list computer puzzles use — the alien
    // hands over a small sudoku instead of just talking, and solving it is
    // what actually decodes the name.
    state = 'puzzle';
    showSudokuPuzzle(
      () => {
        state = 'playing';
        talkTargetAlien.caught = true;
        talkTargetAlien.mode = 'caughtReaction';
        talkTargetAlien.reactionRemaining = 900;
        talkTargetAlien.fadeTo('Alien_Clapping', { duration: 0.2 });
        caughtCount += 1;
        missionComplete = true;
        astronaut.playFlourish('Interact');
        revealFourthClientName();
      },
      () => { state = 'playing'; },
    );
  }

  function updateInteract() {
    if (!consumeInteractPress()) return;
    const shipDist = Math.hypot(playerPos.x - shipSpot.x, playerPos.z - shipSpot.z);
    if (shipDist <= SHIP_INTERACT_RADIUS) { handleShipInteract(); return; }
    if (talkTargetAlien && !talkTargetAlien.caught) {
      const alienDist = Math.hypot(playerPos.x - talkTargetAlien.pos.x, playerPos.z - talkTargetAlien.pos.z);
      if (alienDist <= ALIEN_TALK_RADIUS) handleAlienTalk();
    }
  }

  function updateMovement(dt) {
    let turn = 0;
    if (keys.left) turn += 1;
    if (keys.right) turn -= 1;
    yaw += turn * TURN_SPEED * dt;
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);

    let speed = 0;
    let anim = 'Idle';
    if (keys.up) {
      speed = keys.shift ? RUN_SPEED : WALK_SPEED;
      anim = keys.shift ? 'Run' : 'Walk';
    } else if (keys.down) {
      speed = -BACKWARD_SPEED;
      anim = 'Walk';
    }

    if (speed !== 0) {
      const candidateX = playerPos.x + forward.x * speed * dt;
      const candidateZ = playerPos.z + forward.z * speed * dt;
      const distToShip = Math.hypot(candidateX - shipSpot.x, candidateZ - shipSpot.z);
      const hitY = sampleGroundY(candidateX, candidateZ);
      const blocked = hitY === null
        || Math.abs(hitY - groundY) > MAX_GROUND_STEP
        || distToShip < SHIP_BLOCK_RADIUS + PLAYER_COLLISION_RADIUS
        || isBlockedByAlien(candidateX, candidateZ)
        || isBlockedByHut(candidateX, candidateZ);
      if (!blocked) {
        playerPos.x = candidateX;
        playerPos.z = candidateZ;
        groundY = hitY;
      }
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

    playerPos.y = groundY;
    astronaut.object3D.position.set(playerPos.x, playerPos.y + jumpHeight, playerPos.z);
    const orientQuat = yawQuat.clone();
    if (astronaut.modelForwardOffset) {
      orientQuat.multiply(new THREE.Quaternion().setFromAxisAngle(UP, astronaut.modelForwardOffset));
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

  function updateMinimap() {
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQuat);
    const blips = [];
    function addBlip(x, z, color, size, shape) {
      const rel = new THREE.Vector3(x - playerPos.x, 0, z - playerPos.z);
      blips.push({
        dx: rel.dot(right), dy: rel.dot(forward), color, size, shape,
      });
    }
    addBlip(shipSpot.x, shipSpot.z, '#7bffb0', 7, 'ship');
    for (const alien of aliens) {
      if (alien.caught) continue;
      let color = alien.mode === 'fleeing' ? '#ff6b57' : '#ffd166';
      if (alien === talkTargetAlien) color = '#8be9ff';
      addBlip(alien.pos.x, alien.pos.z, color, alien === talkTargetAlien ? 6 : 5);
    }
    minimap.draw(blips);
  }

  function updateCamera(dt, camera) {
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);
    const camTarget = playerPos.clone()
      .addScaledVector(forward, -CAM_DISTANCE)
      .addScaledVector(UP, CAM_HEIGHT);
    if (snapCameraNext) {
      camera.position.copy(camTarget);
      snapCameraNext = false;
    } else {
      camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt));
    }
    camera.up.copy(UP);
    const lookTarget = playerPos.clone().addScaledVector(UP, LOOK_HEIGHT);
    camera.lookAt(lookTarget);
  }

  function updateShadowLight() {
    sun.position.set(playerPos.x - 50, playerPos.y + 70, playerPos.z + 40);
    sun.target.position.copy(playerPos);
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
      updateAliens(dt);
      updateCamera(dt, camera);
      updateShadowLight();
      updateMinimap();
    },
    destroy() {
      minimap.destroy();
    },
  };
}
