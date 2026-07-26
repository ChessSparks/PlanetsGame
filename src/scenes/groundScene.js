import * as THREE from 'three';
import {
  createPlanetGround, createDrone, createOrbitRing, createSun,
} from '../entities.js';
import { loadAstronaut } from '../game/character.js';
import { loadDecoration } from '../game/models.js';
import { createPlanetWalker, fibonacciSphere, orientToNormal } from '../game/planet.js';
import { keys, consumeInteractPress, consumeJumpPress } from '../game/input.js';
import {
  hideHud, showOverlay, flashToast, setKeysDisplay, announceObjective, flashScreenWhite,
} from '../game/hud.js';
import { speak } from '../game/voice.js';
import { createMinimap } from '../game/minimap.js';
import { showSlidingPuzzle, hideSlidingPuzzle } from '../game/puzzle.js';
import {
  unlockAudio, playFootstep, playPickupChime, playDroneAlert,
} from '../game/audio.js';

const PLANET_RADIUS = 22;

const WALK_SPEED = 3.2;
const RUN_SPEED = 6.4;
const BACKWARD_SPEED = 2.0;
const TURN_SPEED = 2.4;

const JUMP_SPEED = 6.5;
const GRAVITY = 18;
// The rig has no authored jump clip, so airborne reuses the existing "Run"
// clip (already more bent-kneed than Walk/Idle) rather than posing bones
// directly — bone rotation kept distorting the boots via the mesh's skin
// weights. A small whole-body squash on top exaggerates it a bit further;
// scaling the whole rig (rather than individual bones) is skinning-safe.
const JUMP_SQUASH_REFERENCE = 0.4;
const JUMP_SQUASH_AMOUNT = 0.08;
const FOOTSTEP_INTERVAL_WALK = 0.42;
const FOOTSTEP_INTERVAL_RUN = 0.26;

const CAM_DISTANCE = 6.5;
const CAM_HEIGHT = 3.0;
const LOOK_HEIGHT = 1.4;

function sph(latDeg, lonDeg) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  );
}

// Player spawns facing forward = (0,0,-1), which in sph()'s convention is
// lon ~180°, not lon ~0 — these both sit close to spawn AND in front of the
// starting facing direction so they're visible immediately without turning.
const SHIP_SPOT = { normal: sph(78, 160), clear: 0.22 };
const KEY_FINDER_SPOT = { normal: sph(70, -160), clear: 0.14 };
const HOUSE_SPOTS = [
  { normal: sph(15, 150), clear: 0.28 },
  { normal: sph(10, 172), clear: 0.28 },
  { normal: sph(24, 192), clear: 0.28 },
];
const VOLCANO_SPOT = { normal: sph(-35, 12), clear: 0.4 };
// A short walk from the main volcano — where the fuel puzzle lives, found
// only after the ship is repaired.
const SMALL_VOLCANO_SPOT = { normal: sph(-24, 30), clear: 0.15 };
const WILDLIFE_SPOTS = [
  { normal: sph(6, -50), url: '/assets/deer.glb', height: 1.2 },
  { normal: sph(-6, -72), url: '/assets/deer.glb', height: 1.15 },
  { normal: sph(20, -112), url: '/assets/stag.glb', height: 1.4 },
  { normal: sph(-16, -132), url: '/assets/stag.glb', height: 1.35 },
];
const SPAWN_CLEAR = { normal: new THREE.Vector3(0, 1, 0), clear: 0.16 };

// The 3 keys needed to repair the spaceship, spread out to encourage
// exploring the whole planet. Two of them are guarded by patrol drones.
const KEY_SPOTS = [
  { normal: sph(-15, 60), clear: 0.1 },
  { normal: sph(35, 210), clear: 0.1 },
  { normal: sph(-30, -100), clear: 0.1 },
];
const DRONE_PATROLS = [
  { center: KEY_SPOTS[0].normal, orbitRadius: 3.2, altitude: 2.4, speed: 0.6, phase: 0 },
  { center: KEY_SPOTS[2].normal, orbitRadius: 3.6, altitude: 2.6, speed: 0.5, phase: 2.1 },
];
const KEY_PICKUP_RADIUS = 1.1;
const FINDER_PICKUP_RADIUS = 1.2;
const DRONE_HAZARD_RADIUS = 1.4;
// Patrol orbit keeps a drone's distance from the player's max walking height
// (sqrt((PLANET_RADIUS+altitude)^2 + orbitRadius^2) - PLANET_RADIUS) always
// well above PLAYER_COLLISION_RADIUS + DRONE_HAZARD_RADIUS, so contact only
// ever happens once a drone leaves patrol and chases the player directly.
const DRONE_AGGRO_RADIUS = 9; // distance at which a patrolling drone notices the player and gives chase
const DRONE_DISENGAGE_RADIUS = 13; // distance at which a chasing drone gives up and returns to its post
const DRONE_CHASE_ALTITUDE = 1.0; // hover height above the player while chasing — low enough for contact to land
// Pure-pursuit steering (aimed at the player's current spot, not led ahead)
// lets a drone cut corners every time the player turns, which happens
// constantly on a sphere with obstacles — so a nominal speed edge alone
// isn't enough margin to feel escapable. Chase speed sits well under
// RUN_SPEED for that, and DRONE_MAX_CHASE_SECONDS guarantees a chase always
// ends even on a run where the player never clears the disengage radius.
const DRONE_CHASE_SPEED = 3.9; // units/sec while chasing
const DRONE_MAX_CHASE_SECONDS = 8; // hard cap on chase duration regardless of distance
const DRONE_PATROL_CATCH_SPEED = 8; // units/sec used to fly back onto the orbit path once a chase ends
// Must clear SHIP_BLOCK_RADIUS + PLAYER_COLLISION_RADIUS (the closest the
// player can physically stand, since the ship is solid) with margin to spare.
const SHIP_INTERACT_RADIUS = 4.6;
const SMALL_VOLCANO_INTERACT_RADIUS = 2.6;

const CLEAR_ZONES = [
  SPAWN_CLEAR,
  SHIP_SPOT,
  KEY_FINDER_SPOT,
  VOLCANO_SPOT,
  SMALL_VOLCANO_SPOT,
  ...HOUSE_SPOTS,
  ...KEY_SPOTS,
  ...WILDLIFE_SPOTS.map((w) => ({ normal: w.normal, clear: 0.11 })),
];

// Where a drone would be right now if it were purely following its patrol
// orbit, regardless of its current actual position (used both for normal
// patrolling and as the fly-back target after a chase ends).
function orbitPosition(drone, elapsed, target = new THREE.Vector3()) {
  const t = elapsed * drone.speed + drone.phase;
  return target.copy(drone.center)
    .multiplyScalar(PLANET_RADIUS + drone.altitude)
    .addScaledVector(drone.u, Math.cos(t) * drone.orbitRadius)
    .addScaledVector(drone.v, Math.sin(t) * drone.orbitRadius);
}

// Steps `pos` toward `target` by at most `maxStep`, landing exactly on it
// once in range — gives drones a finite flight speed instead of teleporting.
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

function tangentBasis(normal) {
  const hint = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(hint, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

// blockRadiusFactor is multiplied by the instance's height to approximate
// its trunk/base footprint for collision — only trees and rocks block the
// player; low foliage stays walk-through. sway* marks it as wind-animated
// (rocks stay rigid).
const FOREST = [
  { url: '/assets/pine.glb', height: [3.0, 5.0], weight: 5, blockRadiusFactor: 0.16, swayAmplitude: 0.03, swaySpeed: 0.7 },
  { url: '/assets/rock.glb', height: [0.6, 1.8], weight: 4, blockRadiusFactor: 0.5 },
  { url: '/assets/bush.glb', height: [0.6, 1.1], weight: 3, swayAmplitude: 0.06, swaySpeed: 1.1 },
  { url: '/assets/fern.glb', height: [0.4, 0.7], weight: 3, swayAmplitude: 0.09, swaySpeed: 1.4 },
  { url: '/assets/grass.glb', height: [0.3, 0.5], weight: 3, swayAmplitude: 0.12, swaySpeed: 1.7 },
  { url: '/assets/plant.glb', height: [0.5, 0.9], weight: 2, swayAmplitude: 0.08, swaySpeed: 1.3 },
];
const FOREST_COUNT = 220;

const HOUSE_BLOCK_RADIUS = 3.2;
const VOLCANO_BLOCK_RADIUS = 4.5;
const SMALL_VOLCANO_BLOCK_RADIUS = 1.8;
const SHIP_BLOCK_RADIUS = 3.0;
const PLAYER_COLLISION_RADIUS = 0.45;

const CLOUD_COUNT = 16;
const CLOUD_ALTITUDE = 8;

const SATELLITE_ORBIT_RADIUS = PLANET_RADIUS + 9;
const SATELLITE_ORBIT_AXIS = new THREE.Vector3(0.25, 1, 0.12).normalize();

const EARTH_DIRECTION = new THREE.Vector3(0.3, 0.45, -1).normalize();
const EARTH_DISTANCE = 240;

// A trinary-star sky: one main sun roughly in front of spawn, two smaller
// companions spread around so the sky reads as three-sunned from anywhere.
const SUNS = [
  { direction: new THREE.Vector3(0.3, 0.5, -1).normalize(), distance: 180, size: 12, color: 0xfff2cf, lightIntensity: 1.2 },
  { direction: new THREE.Vector3(-0.85, 0.4, -0.5).normalize(), distance: 210, size: 8, color: 0xffb877, lightIntensity: 0.5 },
  { direction: new THREE.Vector3(0.75, 0.35, 0.4).normalize(), distance: 230, size: 7, color: 0xbfe0ff, lightIntensity: 0.4 },
];

// Normalized model bounding boxes rarely put the visual base exactly at the
// true "ground" of the mesh (padding, foliage sprites, etc.), which left
// everything looking like it hovered just above the surface. Sinking each
// category in slightly by its own depth hides that gap.
const EMBED = {
  forest: 0.35, house: 0.95, volcano: 1.4, smallVolcano: 0.55, wildlife: 0.25, ship: 0.5,
};

function placeOnSurface(object, normal, embed) {
  object.position.copy(normal).multiplyScalar(PLANET_RADIUS - embed);
}

// Pickups hover just above the surface rather than sinking into it.
function hoverPlace(object, normal, height) {
  object.position.copy(normal).multiplyScalar(PLANET_RADIUS + height);
  orientToNormal(object, normal, 0);
}

// In-engine crash cutscene: the ship falls from CUTSCENE_DROP_ALTITUDE above
// (and CUTSCENE_DROP_LATERAL to the side of) its resting spot, sweeping in
// at an angle rather than dropping straight down, and settles into exactly
// the transform placeShip() already gave it — no separate "final pose" to
// keep in sync.
const CUTSCENE_DURATION = 6.5;
const CUTSCENE_DROP_ALTITUDE = 60;
const CUTSCENE_DROP_LATERAL = 22;
const SMOKE_FALL_INTERVAL = 0.05; // seconds between puffs while the ship is falling
const SMOKE_TAIL_INTERVAL = 0.35; // seconds between puffs from the wreck afterward
const SMOKE_TAIL_DURATION = 4; // how long the wreck keeps smoking post-impact

// onLaunch(fuelCellsCollected, totalFuelCells) is invoked once the player
// has repaired the ship, secured fuel via the volcano puzzle, and interacts
// with the ship again — the caller (main.js) uses it to transition into the
// ascent minigame.
export async function createGroundScene({ onLaunch } = {}) {
  hideHud();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd0ff);
  scene.fog = new THREE.Fog(0xbfe6ff, 60, 190);

  scene.add(new THREE.AmbientLight(0xcfe8ff, 0.7));
  let shadowLight = null;
  for (const [i, s] of SUNS.entries()) {
    const light = new THREE.DirectionalLight(s.color, s.lightIntensity);
    light.position.copy(s.direction).multiplyScalar(100);
    scene.add(light);

    // Only the brightest sun casts a shadow — a fixed shadow frustum can't
    // cover a full sphere the player can walk anywhere on, so this light is
    // re-centered on the player every frame (see updateShadowLight below).
    if (i === 0) {
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.near = 1;
      light.shadow.camera.far = 70;
      light.shadow.camera.left = -22;
      light.shadow.camera.right = 22;
      light.shadow.camera.top = 22;
      light.shadow.camera.bottom = -22;
      light.shadow.bias = -0.0015;
      light.target = new THREE.Object3D();
      scene.add(light.target);
      shadowLight = light;
    }

    const sunMesh = createSun(s.color, s.size);
    sunMesh.position.copy(s.direction).multiplyScalar(s.distance);
    scene.add(sunMesh);
  }
  const shadowLightOffset = SUNS[0].direction.clone().multiplyScalar(40);

  const planet = createPlanetGround(PLANET_RADIUS);
  scene.add(planet);

  let walker = createPlanetWalker();
  const obstacles = []; // { normal, radius } — filled in as blocking decorations load
  const windSwayables = []; // { mesh, baseQuat, amplitude, speed, phase } — foliage that sways in the wind
  let jumpVelocity = 0;
  let jumpHeight = 0;
  let footstepTimer = 0;

  const astronaut = await loadAstronaut();
  scene.add(astronaut.object3D);
  astronaut.fadeTo('Idle', { duration: 0 });

  const cloudLayer = createCloudLayer();
  scene.add(cloudLayer);

  const satellite = new THREE.Group();
  scene.add(satellite);

  const earth = new THREE.Group();
  earth.position.copy(EARTH_DIRECTION).multiplyScalar(EARTH_DISTANCE);
  scene.add(earth);

  // Ship is loaded and placed up front (awaited) so the crash cutscene below
  // has the real mesh to animate falling into its resting transform.
  const ship = await placeShip(scene, obstacles);
  const shipBasis = tangentBasis(SHIP_SPOT.normal);
  let shipRestPos = null;
  let shipRestQuat = null;
  let shipStartPos = null;
  let shipStartQuat = null;
  let shipArcControl = null;
  if (ship) {
    shipRestPos = ship.position.clone();
    shipRestQuat = ship.quaternion.clone();
    shipStartPos = shipRestPos.clone()
      .addScaledVector(SHIP_SPOT.normal, CUTSCENE_DROP_ALTITUDE)
      .addScaledVector(shipBasis.u, CUTSCENE_DROP_LATERAL);
    // Bezier control point sits wide and roughly mid-height, so the path
    // sweeps outward first (a shallow, banking entry) before diving down
    // into the impact point, rather than a straight-line drop.
    shipArcControl = shipRestPos.clone()
      .addScaledVector(SHIP_SPOT.normal, CUTSCENE_DROP_ALTITUDE * 0.55)
      .addScaledVector(shipBasis.u, CUTSCENE_DROP_LATERAL * 1.7);
    shipStartQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 1.1, 0.4));
    ship.position.copy(shipStartPos);
    ship.quaternion.copy(shipStartQuat);
  }

  // The rest of the decorations load and populate in the background so a
  // single bad model (network hiccup, bad asset) can't ever block the planet
  // itself from rendering — each piece is independently fault-tolerant.
  populatePlanet(scene, satellite, earth, obstacles, windSwayables);

  // Keys stay off-scene until the key finder is picked up — spawnKeys() adds
  // them in. resetRun() below re-hides everything after a death.
  const keyPickups = await Promise.all(KEY_SPOTS.map(async (spot) => {
    const mesh = await loadDecoration('/assets/Key.glb', 0.22);
    hoverPlace(mesh, spot.normal, 1.0);
    return { mesh, normal: spot.normal, collected: false };
  }));
  let keysCollected = 0;
  let shipRepaired = false;
  let fuelSecured = false;

  const finderMesh = await loadDecoration('/assets/compass.glb', 0.6);
  hoverPlace(finderMesh, KEY_FINDER_SPOT.normal, 1.0);
  scene.add(finderMesh);
  let finderCollected = false;

  const readyRing = createOrbitRing(4.4);
  orientToNormal(readyRing, SHIP_SPOT.normal, 0);
  readyRing.rotateX(Math.PI / 2);
  readyRing.position.copy(SHIP_SPOT.normal).multiplyScalar(PLANET_RADIUS - EMBED.ship * 0.4);
  readyRing.material.color.set(0x888888);
  readyRing.material.opacity = 0.45;
  scene.add(readyRing);

  // Marks the fuel puzzle site — invisible until relevant (ship repaired,
  // fuel not yet secured), then pulses so it reads as a beacon to walk
  // toward rather than just another static decoration.
  const fuelBeacon = createOrbitRing(2.2);
  orientToNormal(fuelBeacon, SMALL_VOLCANO_SPOT.normal, 0);
  fuelBeacon.rotateX(Math.PI / 2);
  fuelBeacon.position.copy(SMALL_VOLCANO_SPOT.normal).multiplyScalar(PLANET_RADIUS + 0.4);
  fuelBeacon.material.color.set(0xff8c42);
  fuelBeacon.material.opacity = 0;
  scene.add(fuelBeacon);

  const drones = DRONE_PATROLS.map((patrol) => {
    const mesh = createDrone();
    scene.add(mesh);
    return { ...patrol, mesh, ...tangentBasis(patrol.center), mode: 'patrol', chaseTime: 0, disabled: false };
  });

  const minimap = createMinimap();
  minimap.setVisible(false); // stays hidden until the crash cutscene ends

  let state = 'cutscene';
  let cutsceneElapsed = 0;
  let cutsceneDone = false;
  let cutsceneFlashed = false;
  const cutsceneShipPos = new THREE.Vector3();
  const cutsceneWobbleEuler = new THREE.Euler();
  const cutsceneWobbleQuat = new THREE.Quaternion();

  // Trails from the ship the whole time it's falling, then tapers off into
  // an occasional wisp from the wreck — runs on real time (not gated to the
  // cutscene state) so the tail keeps drifting once gameplay has started.
  const smokeParticles = []; // { mesh, age, lifetime, velocity, baseOpacity }
  let smokeElapsed = 0;
  let smokeSpawnTimer = 0;

  function announce(text) {
    announceObjective(text);
    speak(text);
  }

  function spawnKeys() {
    for (const key of keyPickups) scene.add(key.mesh);
  }

  function resetRun() {
    walker = createPlanetWalker();
    finderCollected = false;
    keysCollected = 0;
    shipRepaired = false;
    fuelSecured = false;
    hideSlidingPuzzle();
    scene.add(finderMesh);
    for (const key of keyPickups) {
      key.collected = false;
      scene.remove(key.mesh);
    }
    readyRing.material.color.set(0x888888);
    readyRing.material.opacity = 0.45;
    for (const drone of drones) {
      drone.mode = 'patrol';
      drone.chaseTime = 0;
      drone.disabled = false;
    }
    setKeysDisplay(0, keyPickups.length);
    state = 'playing';
    announce('You were caught. Restarting the search — find the key finder first.');
  }

  function handleDeath() {
    state = 'dead';
    showOverlay(
      'You Died',
      'A patrol drone caught you. Progress on this run is lost — you\'ll need to find the key finder again.',
      'Try Again',
      () => resetRun(),
    );
  }

  function finishCutscene() {
    minimap.setVisible(true);
    state = 'intro';
    setKeysDisplay(0, keyPickups.length);
    showOverlay(
      'A Quiet Planet',
      'Your spaceship (nearby!) needs repairing. First find the key finder device, then use it to track down the 3 hidden keys, then return to the ship and press E.\nTwo of the keys are guarded by patrol drones — get too close and they\'ll chase you down. Touching one is fatal, but you can outrun them.\n\nW/↑: Walk   S/↓: Back   A/D: Turn   Shift: Run   Space: Jump   E: Interact',
      'Begin',
      () => {
        unlockAudio();
        state = 'playing';
        announce('Objective: find the key finder device nearby.');
      },
    );
  }

  // Drives the whole crash sequence directly by setting camera.position/
  // lookAt each frame — the normal player-follow updateCamera() is skipped
  // entirely while state === 'cutscene' (see update() below).
  function updateCutscene(dt, camera) {
    cutsceneElapsed += dt;
    const t = Math.min(1, cutsceneElapsed / CUTSCENE_DURATION);

    if (ship) {
      const te = t * t; // ease-in — falls slowly at first, accelerates in

      // Quadratic Bezier through shipArcControl, so the ship sweeps out on a
      // banking curve rather than dropping in a straight line.
      const mt = 1 - te;
      cutsceneShipPos.set(0, 0, 0)
        .addScaledVector(shipStartPos, mt * mt)
        .addScaledVector(shipArcControl, 2 * mt * te)
        .addScaledVector(shipRestPos, te * te);
      ship.position.copy(cutsceneShipPos);

      // Tumbling wobble on top of the base orientation slerp, violent at
      // first and settling out as the ship nears the ground.
      const wobbleAmp = (1 - t) * (1 - t) * 0.5;
      cutsceneWobbleEuler.set(
        Math.sin(cutsceneElapsed * 5.3) * wobbleAmp,
        Math.sin(cutsceneElapsed * 3.7) * wobbleAmp * 0.6,
        Math.sin(cutsceneElapsed * 4.1) * wobbleAmp,
      );
      cutsceneWobbleQuat.setFromEuler(cutsceneWobbleEuler);
      ship.quaternion.copy(shipStartQuat).slerp(shipRestQuat, te).multiply(cutsceneWobbleQuat);
    }
    const focusPos = ship ? ship.position : shipRestPos
      ?? SHIP_SPOT.normal.clone().multiplyScalar(PLANET_RADIUS);

    let shake = 0;
    if (t < 0.3) {
      // Shot A — wide establishing shot, camera fixed, planet + falling ship both in frame.
      camera.position.copy(SHIP_SPOT.normal)
        .multiplyScalar(PLANET_RADIUS + 55)
        .addScaledVector(shipBasis.u, 45)
        .addScaledVector(shipBasis.v, 10);
      camera.up.copy(SHIP_SPOT.normal);
      camera.lookAt(focusPos);
    } else if (t < 0.55) {
      // Shot B — tracking shot, trailing behind and above the ship.
      camera.position.copy(focusPos)
        .addScaledVector(shipBasis.u, -14)
        .addScaledVector(SHIP_SPOT.normal, 8);
      camera.up.copy(SHIP_SPOT.normal);
      camera.lookAt(focusPos);
    } else if (t < 0.85) {
      // Shot C — close chase through atmosphere entry, shake ramping up.
      camera.position.copy(focusPos)
        .addScaledVector(shipBasis.u, -7)
        .addScaledVector(SHIP_SPOT.normal, 3);
      camera.up.copy(SHIP_SPOT.normal);
      camera.lookAt(focusPos);
      shake = THREE.MathUtils.mapLinear(t, 0.55, 0.85, 0, 0.35);
    } else {
      // Shot D — low fixed angle on the crash site; shake spikes on impact.
      camera.position.copy(SHIP_SPOT.normal)
        .multiplyScalar(PLANET_RADIUS + 2)
        .addScaledVector(shipBasis.u, 7)
        .addScaledVector(shipBasis.v, 4);
      camera.up.copy(SHIP_SPOT.normal);
      camera.lookAt(focusPos);
      shake = THREE.MathUtils.mapLinear(Math.min(t, 0.97), 0.85, 0.97, 0.35, 1.3);
      if (t >= 0.97 && !cutsceneFlashed) {
        cutsceneFlashed = true;
        flashScreenWhite(300);
      }
    }

    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
    }

    if (t >= 1 && !cutsceneDone) {
      cutsceneDone = true;
      finishCutscene();
    }
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
    if (hitsObstacle(walker.normal, obstacles)) {
      walker.normal.copy(prevNormal);
      walker.forward.copy(prevForward);
    }

    if (speed !== 0 && jumpHeight <= 0) {
      footstepTimer -= dt;
      if (footstepTimer <= 0) {
        playFootstep(anim === 'Run' ? 1 : 0.7);
        footstepTimer = anim === 'Run' ? FOOTSTEP_INTERVAL_RUN : FOOTSTEP_INTERVAL_WALK;
      }
    } else {
      footstepTimer = 0;
    }

    const newPos = walker.getPosition(PLANET_RADIUS);
    for (const drone of drones) {
      if (drone.disabled) continue;
      if (newPos.distanceTo(drone.mesh.position) < PLAYER_COLLISION_RADIUS + DRONE_HAZARD_RADIUS) {
        handleDeath();
        return;
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

  function updateFinderPickup() {
    if (finderCollected) return;
    const dist = PLANET_RADIUS * walker.normal.angleTo(KEY_FINDER_SPOT.normal);
    finderMesh.rotateY(0.02);
    if (dist < FINDER_PICKUP_RADIUS) {
      finderCollected = true;
      scene.remove(finderMesh);
      spawnKeys();
      playPickupChime();
      flashToast('Key finder acquired!', 2000);
      astronaut.fadeTo('Interact', {
        duration: 0.15, loop: false,
        onFinished: () => astronaut.fadeTo('Idle', { duration: 0.2 }),
      });
      announce('Key finder online. Objective: find the 3 keys hidden across the planet.');
    }
  }

  function updateKeyPickups(dt) {
    if (!finderCollected) return;
    const playerPos = walker.getPosition(PLANET_RADIUS);
    for (const key of keyPickups) {
      if (key.collected) continue;
      key.mesh.rotateY(dt * 1.8);
      if (key.mesh.position.distanceTo(playerPos) < KEY_PICKUP_RADIUS) {
        key.collected = true;
        scene.remove(key.mesh);
        keysCollected += 1;
        playPickupChime();
        setKeysDisplay(keysCollected, keyPickups.length);
        astronaut.fadeTo('Interact', {
          duration: 0.15, loop: false,
          onFinished: () => astronaut.fadeTo('Idle', { duration: 0.2 }),
        });
        // Any drone guarding this specific key (patrol center === key spot)
        // has nothing left to protect, so it stands down for the rest of the run.
        const guard = drones.find((drone) => drone.center === key.normal);
        let guardMessage = '';
        if (guard) {
          guard.disabled = true;
          guard.mode = 'patrol';
          guard.chaseTime = 0;
          guardMessage = 'Guardian drone deactivated — that key is safe now. ';
        }
        if (keysCollected >= keyPickups.length) {
          announce(`${guardMessage}All keys recovered. Objective: return to the spaceship and press E to repair it.`);
        } else {
          if (guardMessage) announce(guardMessage.trim());
          flashToast(`Key found! (${keysCollected}/${keyPickups.length})`, 2000);
        }
      }
    }
  }

  // A single consumeInteractPress() per frame is shared across both
  // interactables (ship and small volcano) — calling it twice would silently
  // drop whichever check ran second, since the press is one-shot.
  function updateInteract() {
    if (!consumeInteractPress()) return;

    const shipDist = PLANET_RADIUS * walker.normal.angleTo(SHIP_SPOT.normal);
    if (shipDist <= SHIP_INTERACT_RADIUS) {
      handleShipInteract();
      return;
    }

    const volcanoDist = PLANET_RADIUS * walker.normal.angleTo(SMALL_VOLCANO_SPOT.normal);
    if (volcanoDist <= SMALL_VOLCANO_INTERACT_RADIUS) {
      handleFuelPuzzleInteract();
    }
  }

  function handleShipInteract() {
    if (shipRepaired && fuelSecured) {
      onLaunch?.(1, 1);
      return;
    }
    if (shipRepaired) {
      flashToast('Still need fuel — find the small volcano nearby and solve its puzzle.', 2400);
      return;
    }
    if (!finderCollected) {
      flashToast('Find the key finder device first.', 2200);
      return;
    }
    if (keysCollected < keyPickups.length) {
      flashToast(`Need ${keyPickups.length - keysCollected} more key(s) to repair the ship.`, 2200);
      return;
    }
    shipRepaired = true;
    readyRing.material.color.set(0x7bffb0);
    readyRing.material.opacity = 0.85;
    playPickupChime();
    flashToast('Spaceship repaired!', 2200);
    announce('Spaceship repaired. Objective: find the small volcano nearby and solve its puzzle to secure fuel.');
  }

  function handleFuelPuzzleInteract() {
    if (fuelSecured) {
      flashToast('Fuel cell already secured.', 1800);
      return;
    }
    if (!shipRepaired) {
      flashToast('Nothing to do here yet — repair the spaceship first.', 2200);
      return;
    }
    state = 'puzzle';
    showSlidingPuzzle(
      () => {
        fuelSecured = true;
        state = 'playing';
        playPickupChime();
        flashToast('Fuel cell secured!', 2200);
        announce('Fuel secured. Return to the spaceship and press E to launch.');
      },
      () => {
        state = 'playing';
      },
    );
  }

  function updateFuelBeacon(elapsed) {
    fuelBeacon.material.opacity = (shipRepaired && !fuelSecured)
      ? 0.35 + Math.sin(elapsed * 3) * 0.25
      : 0;
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

    addBlip(SHIP_SPOT.normal, shipRepaired ? '#7bffb0' : '#ffd166', 7, 'ship');
    addBlip(VOLCANO_SPOT.normal, '#ff5e3a', 5);
    if (!finderCollected) addBlip(KEY_FINDER_SPOT.normal, '#ffb347', 5);
    if (finderCollected) {
      for (const key of keyPickups) if (!key.collected) addBlip(key.normal, '#7be0ff', 4);
    }
    if (shipRepaired && !fuelSecured) addBlip(SMALL_VOLCANO_SPOT.normal, '#ff8c42', 5);
    for (const drone of drones) {
      if (drone.disabled) continue;
      addBlip(drone.mesh.position.clone().normalize(), '#ff4d4d', 4);
    }

    minimap.draw(blips);
  }

  const droneChaseTarget = new THREE.Vector3();
  const droneOrbitTarget = new THREE.Vector3();

  function updateDrones(dt, elapsed, playerPos, playerNormal) {
    for (const drone of drones) {
      if (drone.disabled) {
        orbitPosition(drone, elapsed, droneOrbitTarget);
        moveToward(drone.mesh.position, droneOrbitTarget, DRONE_PATROL_CATCH_SPEED * dt);
        for (const r of drone.mesh.userData.rotors) r.rotation.y += dt * 30;
        drone.mesh.userData.blinkLight.visible = false;
        continue;
      }

      const distToPlayer = drone.mesh.position.distanceTo(playerPos);
      if (drone.mode === 'patrol' && distToPlayer < DRONE_AGGRO_RADIUS) {
        drone.mode = 'chase';
        drone.chaseTime = 0;
        if (state === 'playing') {
          flashToast('A drone spotted you — run!', 1800);
          playDroneAlert();
        }
      } else if (drone.mode === 'chase'
        && (distToPlayer > DRONE_DISENGAGE_RADIUS || drone.chaseTime > DRONE_MAX_CHASE_SECONDS)) {
        drone.mode = 'patrol';
      }

      if (drone.mode === 'chase') {
        drone.chaseTime += dt;
        droneChaseTarget.copy(playerNormal).multiplyScalar(PLANET_RADIUS + DRONE_CHASE_ALTITUDE);
        moveToward(drone.mesh.position, droneChaseTarget, DRONE_CHASE_SPEED * dt);
      } else {
        orbitPosition(drone, elapsed, droneOrbitTarget);
        moveToward(drone.mesh.position, droneOrbitTarget, DRONE_PATROL_CATCH_SPEED * dt);
      }

      const chasing = drone.mode === 'chase';
      for (const r of drone.mesh.userData.rotors) r.rotation.y += dt * (chasing ? 50 : 30);
      drone.mesh.userData.blinkLight.visible = Math.floor(elapsed * (chasing ? 8 : 4)) % 2 === 0;
    }
  }

  function updateCamera(dt, camera) {
    const pos = walker.getPosition(PLANET_RADIUS);
    const camTarget = pos.clone()
      .addScaledVector(walker.forward, -CAM_DISTANCE)
      .addScaledVector(walker.normal, CAM_HEIGHT);
    camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt));
    camera.up.copy(walker.normal);
    const lookTarget = pos.clone().addScaledVector(walker.normal, LOOK_HEIGHT);
    camera.lookAt(lookTarget);
  }

  function updateShadowLight() {
    if (!shadowLight) return;
    const pos = walker.getPosition(PLANET_RADIUS);
    shadowLight.position.copy(pos).add(shadowLightOffset);
    shadowLight.target.position.copy(pos);
  }

  function updateSatellite(elapsed) {
    const angle = elapsed * 0.25;
    const u = satelliteBasis.u;
    const v = satelliteBasis.v;
    satellite.position.set(0, 0, 0)
      .addScaledVector(u, Math.cos(angle) * SATELLITE_ORBIT_RADIUS)
      .addScaledVector(v, Math.sin(angle) * SATELLITE_ORBIT_RADIUS);
    satellite.rotation.y += 0.01;
  }

  function updateClouds(dt) {
    cloudLayer.rotation.y += dt * 0.03;
    cloudLayer.rotation.x += dt * 0.007;
  }

  function updateEarth(dt) {
    earth.rotation.y += dt * 0.04;
  }

  function updateWind(elapsed) {
    for (const sway of windSwayables) {
      sway.mesh.quaternion.copy(sway.baseQuat);
      const t = elapsed * sway.speed + sway.phase;
      sway.mesh.rotateX(Math.sin(t) * sway.amplitude);
      sway.mesh.rotateZ(Math.cos(t * 0.8) * sway.amplitude * 0.6);
    }
  }

  function spawnSmokePuff() {
    const puff = createSmokePuff();
    puff.position.copy(ship.position).addScaledVector(
      new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
      0.4,
    );
    scene.add(puff);
    const velocity = new THREE.Vector3()
      .addScaledVector(SHIP_SPOT.normal, 0.8 + Math.random() * 0.6)
      .addScaledVector(shipBasis.u, (Math.random() - 0.5) * 0.6)
      .addScaledVector(shipBasis.v, (Math.random() - 0.5) * 0.6);
    smokeParticles.push({
      mesh: puff, age: 0, lifetime: 1.2 + Math.random() * 0.6, velocity, baseOpacity: 0.5,
    });
  }

  // Heavy smoke while the ship is actually falling, tapering to an
  // occasional wisp from the wreck for a few seconds after impact, then
  // stopping — existing puffs still finish fading out on their own.
  function updateSmoke(dt) {
    if (ship) {
      smokeElapsed += dt;
      const inFall = smokeElapsed < CUTSCENE_DURATION;
      const inTail = smokeElapsed < CUTSCENE_DURATION + SMOKE_TAIL_DURATION;
      if (inFall || inTail) {
        smokeSpawnTimer -= dt;
        if (smokeSpawnTimer <= 0) {
          smokeSpawnTimer = inFall ? SMOKE_FALL_INTERVAL : SMOKE_TAIL_INTERVAL;
          spawnSmokePuff();
        }
      }
    }

    for (let i = smokeParticles.length - 1; i >= 0; i--) {
      const p = smokeParticles[i];
      p.age += dt;
      if (p.age >= p.lifetime) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        smokeParticles.splice(i, 1);
        continue;
      }
      const lt = p.age / p.lifetime;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.material.opacity = p.baseOpacity * (1 - lt);
      p.mesh.scale.setScalar(1 + lt * 1.8);
    }
  }

  return {
    scene,
    update(dt, elapsed, camera) {
      if (state === 'cutscene') {
        updateCutscene(dt, camera);
      } else {
        // Each gameplay step re-checks state since updateMovement can flip
        // it to 'dead' mid-frame (drone contact) and the rest should stop too.
        if (state === 'playing') updateMovement(dt);
        if (state === 'playing') updateFinderPickup();
        if (state === 'playing') updateKeyPickups(dt);
        if (state === 'playing') updateInteract();
        updateCamera(dt, camera);
      }
      astronaut.update(dt);
      updateShadowLight();
      updateSatellite(elapsed);
      updateClouds(dt);
      updateEarth(dt);
      updateDrones(dt, elapsed, walker.getPosition(PLANET_RADIUS), walker.normal);
      updateSmoke(dt);
      updateWind(elapsed);
      updateFuelBeacon(elapsed);
      updateMinimap();
    },
  };
}

const satelliteBasis = tangentBasis(SATELLITE_ORBIT_AXIS);

function inClearZone(normal) {
  for (const zone of CLEAR_ZONES) {
    if (normal.angleTo(zone.normal) < zone.clear) return true;
  }
  return false;
}

// Distance is measured as arc length along the sphere (angle * radius)
// rather than straight-line, so the embed-depth offset between the player's
// surface radius and a decoration's slightly sunk-in radius doesn't matter.
function hitsObstacle(normal, obstacles) {
  for (const obs of obstacles) {
    const arc = PLANET_RADIUS * normal.angleTo(obs.normal);
    if (arc < PLAYER_COLLISION_RADIUS + obs.radius) return true;
  }
  return false;
}

async function populatePlanet(scene, satelliteGroup, earthGroup, obstacles, windSwayables) {
  const tasks = [
    scatterForest(scene, obstacles, windSwayables),
    placeHouses(scene, obstacles),
    placeVolcano(scene, obstacles),
    placeSmallVolcano(scene, obstacles),
    placeWildlife(scene),
    loadDecoration('/assets/satellite.glb', 3.2).then((wrapper) => {
      wrapper.position.y -= 1.6; // center it rather than feet-at-origin, since it floats in space
      satelliteGroup.add(wrapper);
    }).catch((err) => console.error('Failed to load satellite:', err)),
    loadDecoration('/assets/earth.glb', 34).then((wrapper) => earthGroup.add(wrapper)),
  ];
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Planet decoration failed to load:', result.reason);
  }
}

async function scatterForest(scene, obstacles, windSwayables) {
  const totalWeight = FOREST.reduce((s, d) => s + d.weight, 0);
  function pick() {
    let r = Math.random() * totalWeight;
    for (const d of FOREST) {
      if (r < d.weight) return d;
      r -= d.weight;
    }
    return FOREST[0];
  }

  const points = fibonacciSphere(FOREST_COUNT);
  await Promise.all(points.map(async (point) => {
    if (inClearZone(point)) return;
    const def = pick();
    try {
      const [minH, maxH] = def.height;
      const height = minH + Math.random() * (maxH - minH);
      const instance = await loadDecoration(def.url, height);
      placeOnSurface(instance, point, EMBED.forest);
      orientToNormal(instance, point, Math.random() * Math.PI * 2);
      scene.add(instance);
      if (def.blockRadiusFactor) {
        obstacles.push({ normal: point.clone(), radius: height * def.blockRadiusFactor });
      }
      if (def.swayAmplitude) {
        windSwayables.push({
          mesh: instance,
          baseQuat: instance.quaternion.clone(),
          amplitude: def.swayAmplitude,
          speed: def.swaySpeed,
          phase: Math.random() * Math.PI * 2,
        });
      }
    } catch (err) {
      console.error(`Failed to place ${def.url}:`, err);
    }
  }));
}

// Loaded and placed eagerly (awaited, not part of populatePlanet's
// fire-and-forget tasks) because the crash cutscene needs the actual mesh
// in hand to animate falling into its final resting transform.
async function placeShip(scene, obstacles) {
  try {
    const ship = await loadDecoration('/assets/spaceship.glb', 6.5);
    placeOnSurface(ship, SHIP_SPOT.normal, EMBED.ship);
    orientToNormal(ship, SHIP_SPOT.normal, 0);
    scene.add(ship);
    obstacles.push({ normal: SHIP_SPOT.normal.clone(), radius: SHIP_BLOCK_RADIUS });
    return ship;
  } catch (err) {
    console.error('Failed to place spaceship:', err);
    flashToast('Spaceship model failed to load — see browser console (F12).', 5000);
    return null;
  }
}

async function placeHouses(scene, obstacles) {
  await Promise.all(HOUSE_SPOTS.map(async (spot, i) => {
    try {
      const house = await loadDecoration('/assets/house.glb', 6.0 + (i % 2) * 0.6);
      placeOnSurface(house, spot.normal, EMBED.house);
      orientToNormal(house, spot.normal, i * 0.7);
      scene.add(house);
      obstacles.push({ normal: spot.normal.clone(), radius: HOUSE_BLOCK_RADIUS });
    } catch (err) {
      console.error('Failed to place house:', err);
    }
  }));
}

async function placeVolcano(scene, obstacles) {
  const volcano = await loadDecoration('/assets/volcano.glb', 8.5);
  placeOnSurface(volcano, VOLCANO_SPOT.normal, EMBED.volcano);
  orientToNormal(volcano, VOLCANO_SPOT.normal, 0);
  scene.add(volcano);
  obstacles.push({ normal: VOLCANO_SPOT.normal.clone(), radius: VOLCANO_BLOCK_RADIUS });
}

async function placeSmallVolcano(scene, obstacles) {
  const volcano = await loadDecoration('/assets/volcano.glb', 3.2);
  placeOnSurface(volcano, SMALL_VOLCANO_SPOT.normal, EMBED.smallVolcano);
  orientToNormal(volcano, SMALL_VOLCANO_SPOT.normal, 1.4);
  scene.add(volcano);
  obstacles.push({ normal: SMALL_VOLCANO_SPOT.normal.clone(), radius: SMALL_VOLCANO_BLOCK_RADIUS });
}

async function placeWildlife(scene) {
  await Promise.all(WILDLIFE_SPOTS.map(async (spot) => {
    try {
      const animal = await loadDecoration(spot.url, spot.height);
      placeOnSurface(animal, spot.normal, EMBED.wildlife);
      orientToNormal(animal, spot.normal, Math.random() * Math.PI * 2);
      scene.add(animal);
    } catch (err) {
      console.error(`Failed to place ${spot.url}:`, err);
    }
  }));
}

function createSmokePuff() {
  const geo = new THREE.SphereGeometry(0.5 + Math.random() * 0.35, 6, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2c2c2c, transparent: true, opacity: 0.5, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

function createCloudPuff() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.85,
  });
  const puffCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < puffCount; i++) {
    const r = 0.6 + Math.random() * 0.5;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat);
    puff.position.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 1.2);
    group.add(puff);
  }
  return group;
}

function createCloudLayer() {
  const layer = new THREE.Group();
  const points = fibonacciSphere(CLOUD_COUNT);
  for (const point of points) {
    const cloud = createCloudPuff();
    cloud.position.copy(point).multiplyScalar(PLANET_RADIUS + CLOUD_ALTITUDE);
    orientToNormal(cloud, point, Math.random() * Math.PI * 2);
    layer.add(cloud);
  }
  return layer;
}
