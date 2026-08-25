import * as THREE from 'three';
import {
  createSnowGround, createStarfield, sphereNormalToUv,
} from '../entities.js';
import { loadAstronaut } from '../game/character.js';
import { loadDecoration, loadAnimatedDecoration } from '../game/models.js';
import { createPlanetWalker, fibonacciSphere, orientToNormal } from '../game/planet.js';
import {
  keys, consumeInteractPress, consumeJumpPress, consumeRollPress,
} from '../game/input.js';
import {
  hideHud, showOverlay, flashToast, announceObjective,
} from '../game/hud.js';
import { createMinimap } from '../game/minimap.js';
import { playMusicTheme, playAmbience } from '../game/audio.js';
import { showLabyrinthPuzzle } from '../game/labyrinthPuzzle.js';
import { showWordGuessPuzzle } from '../game/wordGuessPuzzle.js';
import { storyFlags, FOURTH_CLIENT_MIDDLE_NAME } from '../game/storyFlags.js';

// Mission VII: Veyra Station, hunting down buyer #2 — "The Meridian
// Concern" (a company, not a person, per the buyer's list). Same spherical
// planet-walker system as ground/moon/client-world (see game/planet.js) —
// Smite Colony's flat raycast world was the one-off exception for that
// specific landmass model, not the norm. Two things this level adds that
// no other level has: a continuous falling-snow particle system, and a
// trail of footprint marks the player leaves behind while walking — both
// built fresh here since nothing like either exists elsewhere yet.
const STATION_PLANET_RADIUS = 16;

const WALK_SPEED = 3.2;
const RUN_SPEED = 6.4;
const BACKWARD_SPEED = 2.0;
const TURN_SPEED = 2.4;

const JUMP_SPEED = 6.0;
const GRAVITY = 16;
const JUMP_SQUASH_REFERENCE = 0.4;
const JUMP_SQUASH_AMOUNT = 0.08;

const CAM_DISTANCE = 6.5;
const CAM_HEIGHT = 3.0;
const LOOK_HEIGHT = 1.4;

const PLAYER_COLLISION_RADIUS = 0.45;

function sph(latDeg, lonDeg) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  );
}

function tangentBasis(normal) {
  const hint = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(hint, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

// The point exactly `dist` radians from `center`, in the compass direction
// `bearing` (radians, measured in center's own tangent-plane u/v basis) —
// a deterministic sibling of the walker's own moveForward (planet.js):
// same "rotate around the axis perpendicular to both the point and the
// travel direction" technique, just picking a specific bearing instead of
// however the walker happens to currently be facing. Verified numerically
// against the exact intended angular distance (error at floating-point-
// noise level) before relying on it for spot placement below.
function pointAtBearing(center, bearing, dist) {
  const { u, v } = tangentBasis(center);
  const dir = u.clone().multiplyScalar(Math.cos(bearing)).addScaledVector(v, Math.sin(bearing)).normalize();
  const axis = new THREE.Vector3().crossVectors(center, dir).normalize();
  const quat = new THREE.Quaternion().setFromAxisAngle(axis, dist);
  return center.clone().applyQuaternion(quat);
}

const SHIP_SPOT = { normal: sph(75, 0), clear: 0.3 };
const SPAWN_SPOT = { normal: sph(55, 35), clear: 0.14 };
const STATION_SPOT = { normal: sph(20, 55), clear: 0.32 };
// The one hut on the map — the snowman's puzzle gate stands in front of
// it (see SNOWMAN_SPOT below). Placed on the exact opposite side of the
// planet from the station (antipodal: negated latitude, longitude +180°),
// a real walk away rather than just outside the station's own clear
// radius — verified this is comfortably clear of every other spot (all
// well over 2 rad away, vs. the ~0.369 rad that would actually be needed).
const MAIN_HUT_SPOT = { normal: sph(-20, 235), clear: 0.15 };
// A short walk out in front of the hut's own doorway-facing direction
// (bearing 0 in the hut's tangent frame) — far enough out that the hut's
// and snowman's own obstacle radii don't overlap, close enough it reads as
// "standing right in front of the hut."
const SNOWMAN_SPOT = { normal: pointAtBearing(MAIN_HUT_SPOT.normal, 0, 0.2), clear: 0.12 };

const CLEAR_ZONES = [SHIP_SPOT, SPAWN_SPOT, STATION_SPOT, MAIN_HUT_SPOT, SNOWMAN_SPOT];

const ROCK_COUNT = 46;
const SHIP_BLOCK_RADIUS = 3.0;
const SHIP_INTERACT_RADIUS = 4.6;
const STATION_BLOCK_RADIUS = 3.6;
const STATION_INTERACT_RADIUS = 5.8;
const SNOWMAN_INTERACT_RADIUS = 3.2;
const EMBED = { ship: 0.5, rock: 0.12, station: 0.25 };
const LANDING_PAD_RADIUS = SHIP_BLOCK_RADIUS;
const LANDING_PAD_HEIGHT = 0.4;
const LANDING_PAD_EMBED = 0.5;
const LANDING_PAD_TOP_EMBED = LANDING_PAD_EMBED - LANDING_PAD_HEIGHT;

// public/assets/seventh/'s two pieces — a snowy pine and a snowy wooden
// hut — dressing the terrain now that it's actual walkable ground. Same
// loadDecoration "normalize to a target height, feet at local origin"
// convention as the ship/station/rocks; heights picked to sit in the same
// range as this codebase's other trees/houses elsewhere (pines run
// 4-7 units, houses 6-6.6, per groundScene.js) rather than the raw source
// scale, which (like every other Sketchfab-style multi-part import here)
// isn't a meaningful "how tall is this" number on its own.
const TREE_ASSET_PATH = '/assets/seventh/snowy....tree.1..glb';
const TREE_HEIGHT = [3.6, 5.6];
const TREE_COUNT = 18;
const TREE_BLOCK_RADIUS = 0.4; // trunk-only collision — the canopy doesn't block, same convention as groundScene's pines
const TREE_EMBED = 0.15;

// Just the one hut — it's the snowman's puzzle marker, not a scattered
// prop, so it gets a single fixed placement at MAIN_HUT_SPOT (defined up
// with the other fixed spots) rather than a scatter function. Smaller than
// a human house on purpose — reads as a snowed-over line shack rather than
// a real building. HUT_BLOCK_RADIUS scaled down with it (same ratio as the
// height cut, HUT_HEIGHT/5.5) so its collision footprint keeps matching
// its actual (now smaller) visual size.
const HUT_ASSET_PATH = '/assets/seventh/snowy_wooden_hut.glb';
const HUT_HEIGHT = 3.5;
const HUT_BLOCK_RADIUS = 1.15;
const HUT_EMBED = 0.2;

// The seventh folder's third piece — a small rigged, animated snowman
// (single clip: "Greeting") — loaded via loadAnimatedDecoration (not
// loadDecoration, unlike the tree/hut) so its animation actually plays.
// One fixed instance at SNOWMAN_SPOT rather than scattered, since a dozen
// identical waving snowmen would read as silly rather than charming.
const SNOWMAN_ASSET_PATH = '/assets/seventh/snowman_animation.glb';
const SNOWMAN_HEIGHT = 1.8;
const SNOWMAN_BLOCK_RADIUS = 0.5;
const SNOWMAN_EMBED = 0.1;

function placeOnSurface(object, normal, embed) {
  object.position.copy(normal).multiplyScalar(STATION_PLANET_RADIUS - embed);
}

// Turns an already-placed, upright (local +Y along `normal`) object so it
// faces `towardPoint` — used to keep the snowman looking at the player
// rather than frozen facing whatever arbitrary direction it first spawned
// toward. `toward` is flattened onto the tangent plane at `normal` first
// (subtracting out the along-normal component) so a player standing
// directly overhead/underfoot — geometrically impossible on a sphere this
// small in practice, but a zero-length direction is still worth guarding —
// can't tip the snowman off its upright pose or produce a degenerate
// lookAt. Built on THREE.Matrix4's own lookAt (the same tested math
// Object3D.lookAt uses internally) rather than hand-rolled trig — this
// session already caught one real bug in a hand-derived spherical-bearing
// formula, so reaching for library code here instead was deliberate.
//
// lookAt(eye, target, up) points local -Z from eye toward target — the
// standard three.js convention (matches Object3D.lookAt). The snowman
// model itself turned out to be modeled facing +Z rather than that
// standard -Z-forward convention (confirmed in-game: with eye/target the
// "intuitive" way around, it stood with its back to the player), so eye
// and target are swapped below to compensate — the same kind of per-model
// forward-axis correction loadAstronaut's own modelForwardOffset exists
// for, just applied directly here since this loader has no such hook.
const _towardScratch = new THREE.Vector3();
const _targetScratch = new THREE.Vector3();
const _lookMatrixScratch = new THREE.Matrix4();
function orientUprightToward(object3D, normal, towardPoint) {
  _towardScratch.copy(towardPoint).sub(object3D.position);
  _towardScratch.addScaledVector(normal, -_towardScratch.dot(normal));
  if (_towardScratch.lengthSq() < 1e-8) return;
  _targetScratch.copy(object3D.position).add(_towardScratch);
  _lookMatrixScratch.lookAt(_targetScratch, object3D.position, normal);
  object3D.quaternion.setFromRotationMatrix(_lookMatrixScratch);
}

function inClearZone(normal) {
  for (const zone of CLEAR_ZONES) {
    if (normal.angleTo(zone.normal) < zone.clear) return true;
  }
  return false;
}

function hitsObstacle(normal, obstacles) {
  for (const obs of obstacles) {
    const arc = STATION_PLANET_RADIUS * normal.angleTo(obs.normal);
    if (arc < PLAYER_COLLISION_RADIUS + obs.radius) return true;
  }
  return false;
}

function createLandingPad() {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.6, roughness: 0.5 });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(LANDING_PAD_RADIUS, LANDING_PAD_RADIUS * 1.08, LANDING_PAD_HEIGHT, 28),
    baseMat,
  );
  base.position.y = LANDING_PAD_HEIGHT / 2;
  base.receiveShadow = true;
  group.add(base);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x7bd8ff, emissive: 0x1c4a66, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(LANDING_PAD_RADIUS * 0.75, 0.1, 10, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = LANDING_PAD_HEIGHT + 0.02;
  group.add(ring);

  return group;
}

// A small automated outpost — no dedicated "station" asset exists in
// public/assets/, so this is built the same way createLandingPad/
// createMapConsole (moonScene) are: primitives assembled by hand. Central
// hab module + dome cap + two side pods on connector tubes + an antenna
// mast, with a slow-pulsing core light (userData.core) as the one bit of
// life left in an otherwise dead, snowed-over structure.
function createStation() {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.5, roughness: 0.45 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a4d55, metalness: 0.6, roughness: 0.4 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xbfe8ff, emissive: 0x3a7fa0, emissiveIntensity: 0.9,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 2.0, 16), hullMat);
  base.position.y = 1.0;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 1.6, 16), trimMat);
  upper.position.y = 2.8;
  upper.castShadow = true;
  group.add(upper);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    hullMat,
  );
  dome.position.y = 3.6;
  dome.castShadow = true;
  group.add(dome);

  // A ring of small glowing windows around the base module.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.05), windowMat);
    window.position.set(Math.cos(angle) * 2.25, 1.1, Math.sin(angle) * 2.25);
    window.lookAt(window.position.x * 2, 1.1, window.position.z * 2);
    group.add(window);
  }

  // Two smaller side pods on thin connector tubes — reads as a modular
  // outpost rather than a single tower.
  const podOffsets = [
    new THREE.Vector3(3.4, 0.7, 0),
    new THREE.Vector3(-2.6, 0.7, 2.4),
  ];
  for (const offset of podOffsets) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 12), trimMat);
    pod.rotation.z = Math.PI / 2;
    pod.position.copy(offset);
    pod.castShadow = true;
    group.add(pod);

    const connector = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, offset.length(), 8), trimMat);
    connector.position.copy(offset).multiplyScalar(0.5);
    connector.position.y = 1.0;
    connector.rotation.z = Math.PI / 2;
    connector.rotation.y = Math.atan2(offset.z, offset.x);
    group.add(connector);
  }

  // Antenna mast with a slow-pulsing light — the one visible sign the
  // station still has any power left.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), trimMat);
  mast.position.y = 5.4;
  group.add(mast);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff8f6b, emissive: 0xc03a1a, emissiveIntensity: 1.2,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), coreMat);
  core.position.y = 6.5;
  group.add(core);
  group.userData.core = core;

  // Snow caps on the dome and pods — a few flattened white blobs, purely
  // cosmetic, so the structure reads as snowed-over rather than freshly
  // built.
  const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf4f8fb, roughness: 1 });
  const domeCap = new THREE.Mesh(new THREE.SphereGeometry(1.55, 12, 6, 0, Math.PI * 2, 0, Math.PI / 5), snowCapMat);
  domeCap.position.y = 3.62;
  group.add(domeCap);

  group.userData.radius = STATION_BLOCK_RADIUS;
  return group;
}

const SNOW_COUNT = 260;
const SNOW_RADIUS = 13;
const SNOW_HEIGHT = 13;
const SNOW_FALL_SPEED = 2.0;
const SNOW_DRIFT_SPEED = 0.55;

function createSnowflakeTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Snowflakes are tracked in a local frame around the player (u/v tangent +
// height above the surface along the current normal) rather than fixed
// world coordinates, because "down" constantly changes direction as the
// player walks around the sphere — a flake falling straight down in world
// space would drift sideways relative to the ground the moment the player
// moved to a different point on the planet.
function createSnowfall() {
  const local = [];
  for (let i = 0; i < SNOW_COUNT; i++) {
    local.push({
      u: (Math.random() * 2 - 1) * SNOW_RADIUS,
      v: (Math.random() * 2 - 1) * SNOW_RADIUS,
      h: Math.random() * SNOW_HEIGHT,
      driftPhase: Math.random() * Math.PI * 2,
    });
  }
  const positions = new Float32Array(SNOW_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: createSnowflakeTexture(),
    size: 0.22,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points, local, positions,
  };
}

function updateSnowfall(snow, dt, elapsed, centerPos, normal, u, v) {
  const { local, positions, points } = snow;
  for (let i = 0; i < local.length; i++) {
    const p = local[i];
    p.h -= SNOW_FALL_SPEED * dt;
    p.u += Math.sin(elapsed * 0.6 + p.driftPhase) * SNOW_DRIFT_SPEED * dt;
    p.v += Math.cos(elapsed * 0.5 + p.driftPhase) * SNOW_DRIFT_SPEED * dt;
    if (p.h < 0) {
      p.h = SNOW_HEIGHT;
      p.u = (Math.random() * 2 - 1) * SNOW_RADIUS;
      p.v = (Math.random() * 2 - 1) * SNOW_RADIUS;
    }
    const idx = i * 3;
    positions[idx] = centerPos.x + u.x * p.u + v.x * p.v + normal.x * p.h;
    positions[idx + 1] = centerPos.y + u.y * p.u + v.y * p.v + normal.y * p.h;
    positions[idx + 2] = centerPos.z + u.z * p.u + v.z * p.v + normal.z * p.h;
  }
  points.geometry.attributes.position.needsUpdate = true;
}

// How far apart (in world units of actual ground covered) consecutive
// footsteps land — spacing stays even regardless of walk vs. run speed
// since it's driven by distance traveled, not a fixed timer.
const SNOW_TRAMPLE_STEP_DISTANCE = 0.55;
// How far a footstep sits to either side of the walked path — same
// alternating-left/right-foot convention as before, just projected onto
// the ground's own UV space now instead of offsetting a separate decal
// mesh's position.
const SNOW_TRAMPLE_FOOT_OFFSET = 0.14;
const SNOW_TRAMPLE_FOOT_RADIUS = 0.24;
// How deep the ground itself sinks at the darkest (most walked-over) point
// — passed straight into createSnowGround's displacementDepth.
const SNOW_TRAMPLE_DEPTH = 0.4;

// How deep the astronaut's boots/lower legs sink visually into the snow
// while grounded — tapers back to 0 as jumpHeight rises past
// SNOW_SINK_CLEAR_HEIGHT, so legs "pull free" of the snow on a jump instead
// of staying buried mid-air. Deep enough that boots/shins actually clip
// into the ground plane — combined with the ground itself actually
// sinking underfoot (see createSnowGround in entities.js, called with
// SNOW_TRAMPLE_DEPTH below), that reads as "standing in a hollow the snow's
// been pushed out of" rather than the character just being lowered a bit.
const SNOW_LEG_EMBED = 0.34;
const SNOW_SINK_CLEAR_HEIGHT = 0.35;

// A quick puff of kicked-up snow at each footstep, on top of the lasting
// footprint mark — reuses the same soft round sprite texture as the falling
// snow, just short-lived and thrown outward from the step instead of
// drifting down from the sky.
const SNOW_KICK_COUNT_PER_STEP = 4;
const SNOW_KICK_LIFETIME = 0.5;

// The actual "dented snow" now lives in the ground itself — see
// createSnowGround in entities.js, which returns a live-paintable material
// (color darkens + real geometry sinks wherever stampFoot is called), so
// this scene no longer needs its own dent/connector mesh system at all.
// What's left here is just the quick, short-lived flair on top of that: a
// puff of kicked-up snow thrown outward from each step, purely cosmetic
// and unrelated to the ground's own persistent deformation.
function createSnowKickEmitter(scene) {
  const kickTexture = createSnowflakeTexture();
  const kicks = []; // { sprite, age, velocity }

  return {
    spawn(position, normal) {
      for (let i = 0; i < SNOW_KICK_COUNT_PER_STEP; i++) {
        const mat = new THREE.SpriteMaterial({
          map: kickTexture, transparent: true, opacity: 0.85, depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.setScalar(0.1 + Math.random() * 0.08);
        sprite.position.copy(position).addScaledVector(normal, 0.04);
        scene.add(sprite);
        const outward = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        const velocity = normal.clone().multiplyScalar(0.5 + Math.random() * 0.4).addScaledVector(outward, 0.5);
        kicks.push({ sprite, age: 0, velocity });
      }
    },
    update(dt) {
      for (let i = kicks.length - 1; i >= 0; i--) {
        const k = kicks[i];
        k.age += dt;
        if (k.age >= SNOW_KICK_LIFETIME) {
          scene.remove(k.sprite);
          k.sprite.material.dispose();
          kicks.splice(i, 1);
          continue;
        }
        k.sprite.position.addScaledVector(k.velocity, dt);
        k.velocity.multiplyScalar(0.88);
        const t = k.age / SNOW_KICK_LIFETIME;
        k.sprite.material.opacity = 0.85 * (1 - t);
        k.sprite.scale.setScalar(0.1 + t * 0.14);
      }
    },
    destroy() {
      for (const k of kicks) {
        scene.remove(k.sprite);
        k.sprite.material.dispose();
      }
      kicks.length = 0;
    },
  };
}

export async function createVeyraStationScene({ onComplete } = {}) {
  hideHud();
  playMusicTheme('moon'); // placeholder theme until this level gets its own
  playAmbience('moon');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e16);
  scene.fog = new THREE.Fog(0xaebfcc, 40, 150);

  scene.add(new THREE.AmbientLight(0x8fa4bb, 0.7));
  const sun = new THREE.DirectionalLight(0xdbeaff, 1.2);
  sun.position.set(50, 80, 30);
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
  const shadowLightOffset = new THREE.Vector3(50, 80, 30).normalize().multiplyScalar(30);

  const stars = createStarfield(2400, 900, true);
  stars.material.fog = false;
  scene.add(stars);

  const groundSystem = createSnowGround(STATION_PLANET_RADIUS, SNOW_TRAMPLE_DEPTH);
  scene.add(groundSystem.mesh);

  let walker = createPlanetWalker(SPAWN_SPOT.normal.clone(), new THREE.Vector3(0, 0, -1));
  const obstacles = [];
  let jumpVelocity = 0;
  let jumpHeight = 0;

  const astronaut = await loadAstronaut();
  scene.add(astronaut.object3D);
  astronaut.fadeTo('Idle', { duration: 0 });

  const landingPad = createLandingPad();
  placeOnSurface(landingPad, SHIP_SPOT.normal, LANDING_PAD_EMBED);
  orientToNormal(landingPad, SHIP_SPOT.normal, 0);
  scene.add(landingPad);

  const ship = await loadDecoration('/assets/spaceship.glb', 6.5);
  placeOnSurface(ship, SHIP_SPOT.normal, EMBED.ship + LANDING_PAD_TOP_EMBED);
  orientToNormal(ship, SHIP_SPOT.normal, 0);
  scene.add(ship);
  obstacles.push({ normal: SHIP_SPOT.normal.clone(), radius: SHIP_BLOCK_RADIUS });

  const station = createStation();
  placeOnSurface(station, STATION_SPOT.normal, EMBED.station);
  orientToNormal(station, STATION_SPOT.normal, 0);
  scene.add(station);
  obstacles.push({ normal: STATION_SPOT.normal.clone(), radius: STATION_BLOCK_RADIUS });

  // The hut's own facing (bearing 0, matching how SNOWMAN_SPOT was placed
  // "in front of" it) is cosmetic only, unlike the snowman's — nothing
  // reads this back, so a fixed orientation is fine.
  const hut = await loadDecoration(HUT_ASSET_PATH, HUT_HEIGHT);
  placeOnSurface(hut, MAIN_HUT_SPOT.normal, HUT_EMBED);
  orientToNormal(hut, MAIN_HUT_SPOT.normal, 0);
  scene.add(hut);
  obstacles.push({ normal: MAIN_HUT_SPOT.normal.clone(), radius: HUT_BLOCK_RADIUS });

  scatterIceRocks(scene, obstacles);
  scatterSnowyTrees(scene, obstacles);

  const snowman = await loadAnimatedDecoration(SNOWMAN_ASSET_PATH, SNOWMAN_HEIGHT);
  placeOnSurface(snowman.object3D, SNOWMAN_SPOT.normal, SNOWMAN_EMBED);
  orientToNormal(snowman.object3D, SNOWMAN_SPOT.normal, 0);
  scene.add(snowman.object3D);
  snowman.fadeTo('Greeting', { duration: 0 });
  obstacles.push({ normal: SNOWMAN_SPOT.normal.clone(), radius: SNOWMAN_BLOCK_RADIUS });

  const snow = createSnowfall();
  scene.add(snow.points);
  const snowKicks = createSnowKickEmitter(scene);
  let lastTrampleUV = null;
  let leftFoot = true;
  let distanceSinceLastStamp = 0;

  const minimap = createMinimap();

  let snapCameraNext = true;
  let state = 'intro';
  let stationInvestigated = false;
  // The snowman's maze gates the station, same "solve this to proceed"
  // shape as Smite Colony's last-alien sudoku — talk to the snowman first,
  // then the station will actually let you investigate it.
  let snowmanPuzzleSolved = false;

  // No TTS voice for this level — text-only Corthana bubble, same as
  // Smite Colony.
  function announce(text) {
    announceObjective(text);
  }

  showOverlay(
    'Veyra Station',
    'Corthana: Whoever built this place didn\'t plan on it snowing over. It\'s gone quiet — no traffic, no '
    + 'chatter, just the storm.\n\n'
    + 'The Meridian Concern\'s name is all over the old manifests. Let\'s see what they left behind.\n\n'
    + 'There\'s a hut clear on the other side of this rock, something standing out front of it — go talk to '
    + 'it before you try the station.\n\n'
    + 'W/↑: Walk   S/↓: Back   A/D: Turn   Shift: Run   Space: Jump   E: Interact',
    'Begin',
    () => {
      state = 'playing';
      snapCameraNext = true;
      announce('Objective: talk to whatever\'s standing outside the hut.');
    },
  );

  function updateRoll() {
    if (consumeRollPress()) astronaut.playFlourish('Roll', { duration: 0.1, returnDuration: 0.25 });
  }

  function handleShipInteract() {
    astronaut.playFlourish('Interact');
    if (!stationInvestigated) {
      flashToast('Corthana: "Not yet — let\'s see what that station knows first."', 2600);
      return;
    }
    state = 'ending';
    showOverlay(
      'Departing',
      'Whatever the Meridian Concern is, it isn\'t a person you can corner in an alley.\n\n'
      + 'Corthana: "A company\'s harder to run down than a name — but not impossible. Two buyers down, two '
      + 'still out there."',
      'Depart',
      () => onComplete?.(),
    );
  }

  function handleStationInteract() {
    astronaut.playFlourish('Interact');
    if (!snowmanPuzzleSolved) {
      flashToast('Corthana: "That console\'s locked out — whatever\'s guarding it out front wants your attention first."', 2800);
      return;
    }
    if (stationInvestigated) {
      flashToast('The station has nothing left to show you.', 1800);
      return;
    }
    state = 'puzzle';
    showWordGuessPuzzle(
      FOURTH_CLIENT_MIDDLE_NAME,
      () => {
        state = 'playing';
        stationInvestigated = true;
        // Same cross-level flag Smite Colony's alien chase writes a first
        // name into — see storyFlags.js — this level fills in a middle
        // name for that same still-mostly-corrupted buyer #4 entry.
        storyFlags.fourthClientMiddleName = FOURTH_CLIENT_MIDDLE_NAME;
        showOverlay(
          'Cold Storage',
          'The station\'s core is still running — barely. No crew aboard, no distress call ever sent, just '
          + 'shipping logs looping on an automated relay, one fragment of a name buried in the header data.\n\n'
          + 'Corthana: "The Meridian Concern was routing crystals through here for redistribution. Whoever '
          + 'they are, they never set foot on this rock themselves — they just used it."',
          'Continue',
          () => announce('Objective: return to the ship.'),
        );
      },
      () => { state = 'playing'; },
    );
  }

  function handleSnowmanInteract() {
    astronaut.playFlourish('Interact');
    if (snowmanPuzzleSolved) {
      flashToast('The snowman just waves — nothing left to solve here.', 1800);
      return;
    }
    state = 'puzzle';
    showLabyrinthPuzzle(
      () => {
        snowmanPuzzleSolved = true;
        state = 'playing';
        flashToast('The snowman steps aside.', 2200);
        announce('Objective: reach the station and find out what the Meridian Concern was doing here.');
      },
      () => { state = 'playing'; },
    );
  }

  function updateInteract() {
    if (!consumeInteractPress()) return;
    const shipDist = STATION_PLANET_RADIUS * walker.normal.angleTo(SHIP_SPOT.normal);
    if (shipDist <= SHIP_INTERACT_RADIUS) { handleShipInteract(); return; }
    const snowmanDist = STATION_PLANET_RADIUS * walker.normal.angleTo(SNOWMAN_SPOT.normal);
    if (snowmanDist <= SNOWMAN_INTERACT_RADIUS) { handleSnowmanInteract(); return; }
    const stationDist = STATION_PLANET_RADIUS * walker.normal.angleTo(STATION_SPOT.normal);
    if (stationDist <= STATION_INTERACT_RADIUS) handleStationInteract();
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

    if (speed !== 0) {
      const prevNormal = walker.normal.clone();
      const prevForward = walker.forward.clone();
      const right = new THREE.Vector3().crossVectors(walker.normal, walker.forward).normalize();
      walker.moveForward(speed * dt, STATION_PLANET_RADIUS);
      if (hitsObstacle(walker.normal, obstacles)) {
        walker.normal.copy(prevNormal);
        walker.forward.copy(prevForward);
      } else if (jumpHeight <= 0.02) {
        // Only lays tracks while actually in contact with the ground — a
        // mid-air jump shouldn't paint a footprint. Distance-driven (not a
        // fixed timer) so step spacing stays even at walk vs. run speed.
        distanceSinceLastStamp += Math.abs(speed * dt);
        if (distanceSinceLastStamp >= SNOW_TRAMPLE_STEP_DISTANCE) {
          distanceSinceLastStamp = 0;
          const side = leftFoot ? -1 : 1;
          leftFoot = !leftFoot;
          // Offsetting by `right` and renormalizing projects the alternating
          // left/right foot position back onto the sphere's surface, the
          // same way placeOnSurface/orientToNormal elsewhere in this file
          // always work in terms of a unit normal rather than a raw offset
          // position.
          const footNormal = walker.normal.clone()
            .addScaledVector(right, (side * SNOW_TRAMPLE_FOOT_OFFSET) / STATION_PLANET_RADIUS)
            .normalize();
          const uv = sphereNormalToUv(footNormal);
          groundSystem.stampFoot(
            uv.u, uv.v, SNOW_TRAMPLE_FOOT_RADIUS, lastTrampleUV, walker.normal, walker.forward,
          );
          lastTrampleUV = uv;
          snowKicks.spawn(footNormal.clone().multiplyScalar(STATION_PLANET_RADIUS), walker.normal);
        }
      }
    }

    const newPos = walker.getPosition(STATION_PLANET_RADIUS);

    if (consumeJumpPress() && jumpHeight <= 0) {
      jumpVelocity = JUMP_SPEED;
    }
    jumpVelocity -= GRAVITY * dt;
    jumpHeight += jumpVelocity * dt;
    if (jumpHeight < 0) {
      jumpHeight = 0;
      jumpVelocity = 0;
    }

    const snowSink = SNOW_LEG_EMBED * Math.max(0, 1 - jumpHeight / SNOW_SINK_CLEAR_HEIGHT);
    astronaut.object3D.position.copy(newPos).addScaledVector(walker.normal, jumpHeight - snowSink);
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

  function updateMinimap() {
    const right = new THREE.Vector3().crossVectors(walker.normal, walker.forward).normalize();
    const blips = [];
    function addBlip(normal, color, size, shape) {
      const arc = STATION_PLANET_RADIUS * walker.normal.angleTo(normal);
      const toTarget = normal.clone().sub(walker.normal.clone().multiplyScalar(walker.normal.dot(normal)));
      if (toTarget.lengthSq() < 1e-8) {
        blips.push({
          dx: 0, dy: 0, color, size, shape,
        });
        return;
      }
      toTarget.normalize();
      blips.push({
        dx: toTarget.dot(right) * arc, dy: toTarget.dot(walker.forward) * arc, color, size, shape,
      });
    }
    addBlip(SHIP_SPOT.normal, '#7bd8ff', 7, 'ship');
    addBlip(MAIN_HUT_SPOT.normal, '#c9a06a', 6);
    if (!snowmanPuzzleSolved) addBlip(SNOWMAN_SPOT.normal, '#8be9ff', 5);
    if (!stationInvestigated) addBlip(STATION_SPOT.normal, '#ff8f6b', 6);
    minimap.draw(blips);
  }

  function updateCamera(dt, camera) {
    const pos = walker.getPosition(STATION_PLANET_RADIUS);
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
    const pos = walker.getPosition(STATION_PLANET_RADIUS);
    sun.position.copy(pos).add(shadowLightOffset);
    sun.target.position.copy(pos);
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
      snowman.update(dt);
      const pos = walker.getPosition(STATION_PLANET_RADIUS);
      orientUprightToward(snowman.object3D, SNOWMAN_SPOT.normal, pos);
      updateCamera(dt, camera);
      updateShadowLight();
      updateMinimap();
      snowKicks.update(dt);
      const { u, v } = tangentBasis(walker.normal);
      updateSnowfall(snow, dt, elapsed, pos, walker.normal, u, v);
      station.userData.core.scale.setScalar(1 + Math.sin(elapsed * 1.6) * 0.35);
    },
    destroy() {
      minimap.destroy();
      snowKicks.destroy();
    },
  };
}

async function scatterIceRocks(scene, obstacles) {
  const points = fibonacciSphere(ROCK_COUNT);
  await Promise.all(points.map(async (point) => {
    if (inClearZone(point)) return;
    try {
      const height = 0.6 + Math.random() * 1.2;
      const rock = await loadDecoration('/assets/rock.glb', height);
      placeOnSurface(rock, point, EMBED.rock);
      orientToNormal(rock, point, Math.random() * Math.PI * 2);
      scene.add(rock);
      obstacles.push({ normal: point.clone(), radius: height * 0.5 });
    } catch (err) {
      console.error('Failed to place Veyra Station rock:', err);
    }
  }));
}

// Snowy pines, scattered broadly across the whole walkable surface — same
// fibonacci/clear-zone pattern as scatterIceRocks, just its own asset,
// height range, and (much smaller, trunk-only) collision radius.
async function scatterSnowyTrees(scene, obstacles) {
  const points = fibonacciSphere(TREE_COUNT);
  await Promise.all(points.map(async (point) => {
    if (inClearZone(point)) return;
    try {
      const [minH, maxH] = TREE_HEIGHT;
      const height = minH + Math.random() * (maxH - minH);
      const tree = await loadDecoration(TREE_ASSET_PATH, height);
      placeOnSurface(tree, point, TREE_EMBED);
      orientToNormal(tree, point, Math.random() * Math.PI * 2);
      scene.add(tree);
      obstacles.push({ normal: point.clone(), radius: TREE_BLOCK_RADIUS });
    } catch (err) {
      console.error('Failed to place Veyra Station tree:', err);
    }
  }));
}
