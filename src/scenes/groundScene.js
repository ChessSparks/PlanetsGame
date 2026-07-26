import * as THREE from 'three';
import {
  createPlanetGround, createDrone, createOrbitRing, createSun,
} from '../entities.js';
import { loadAstronaut } from '../game/character.js';
import { loadDecoration } from '../game/models.js';
import { createPlanetWalker, fibonacciSphere, orientToNormal } from '../game/planet.js';
import { keys, consumeInteractPress, consumeJumpPress } from '../game/input.js';
import { hideHud, showOverlay, flashToast, setKeysDisplay, announceObjective } from '../game/hud.js';
import { speak } from '../game/voice.js';
import { createMinimap } from '../game/minimap.js';

const PLANET_RADIUS = 22;

const WALK_SPEED = 3.2;
const RUN_SPEED = 6.4;
const BACKWARD_SPEED = 2.0;
const TURN_SPEED = 2.4;

const JUMP_SPEED = 6.5;
const GRAVITY = 18;

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
// Must clear SHIP_BLOCK_RADIUS + PLAYER_COLLISION_RADIUS (the closest the
// player can physically stand, since the ship is solid) with margin to spare.
const SHIP_INTERACT_RADIUS = 4.6;

const CLEAR_ZONES = [
  SPAWN_CLEAR,
  SHIP_SPOT,
  KEY_FINDER_SPOT,
  VOLCANO_SPOT,
  ...HOUSE_SPOTS,
  ...KEY_SPOTS,
  ...WILDLIFE_SPOTS.map((w) => ({ normal: w.normal, clear: 0.11 })),
];

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
const EMBED = { forest: 0.35, house: 0.95, volcano: 1.4, wildlife: 0.25, ship: 0.5 };

function placeOnSurface(object, normal, embed) {
  object.position.copy(normal).multiplyScalar(PLANET_RADIUS - embed);
}

// Pickups hover just above the surface rather than sinking into it.
function hoverPlace(object, normal, height) {
  object.position.copy(normal).multiplyScalar(PLANET_RADIUS + height);
  orientToNormal(object, normal, 0);
}

// Rocket repair / launch gameplay returns once the planet exploration itself
// is solid; for now this scene is exploration-only and ignores any args.
export async function createGroundScene() {
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

  // Decorations load and populate in the background so a single bad model
  // (network hiccup, bad asset) can't ever block the planet itself from
  // rendering — each piece is independently fault-tolerant.
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

  const drones = DRONE_PATROLS.map((patrol) => {
    const mesh = createDrone();
    scene.add(mesh);
    return { ...patrol, mesh, ...tangentBasis(patrol.center) };
  });

  const minimap = createMinimap();

  let state = 'intro';

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
    scene.add(finderMesh);
    for (const key of keyPickups) {
      key.collected = false;
      scene.remove(key.mesh);
    }
    readyRing.material.color.set(0x888888);
    readyRing.material.opacity = 0.45;
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

  hideHud();
  setKeysDisplay(0, keyPickups.length);
  showOverlay(
    'A Quiet Planet',
    'Your spaceship (nearby!) needs repairing. First find the key finder device, then use it to track down the 3 hidden keys, then return to the ship and press E.\nTwo of the keys are guarded by patrol drones — touching one is fatal.\n\nW/↑: Walk   S/↓: Back   A/D: Turn   Shift: Run   Space: Jump   E: Interact',
    'Begin',
    () => {
      state = 'playing';
      announce('Objective: find the key finder device nearby.');
    },
  );

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

    const newPos = walker.getPosition(PLANET_RADIUS);
    for (const drone of drones) {
      if (newPos.distanceTo(drone.mesh.position) < PLAYER_COLLISION_RADIUS + DRONE_HAZARD_RADIUS) {
        handleDeath();
        return;
      }
    }

    if (consumeJumpPress() && jumpHeight <= 0) {
      jumpVelocity = JUMP_SPEED;
      astronaut.fadeTo('Jump', { duration: 0.1 });
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
    if (jumpHeight <= 0) {
      astronaut.fadeTo(anim, { duration: 0.2 });
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
        setKeysDisplay(keysCollected, keyPickups.length);
        astronaut.fadeTo('Interact', {
          duration: 0.15, loop: false,
          onFinished: () => astronaut.fadeTo('Idle', { duration: 0.2 }),
        });
        if (keysCollected >= keyPickups.length) {
          announce('All keys recovered. Objective: return to the spaceship and press E to repair it.');
        } else {
          flashToast(`Key found! (${keysCollected}/${keyPickups.length})`, 2000);
        }
      }
    }
  }

  function updateShipInteract() {
    if (!consumeInteractPress() || shipRepaired) return;
    const dist = PLANET_RADIUS * walker.normal.angleTo(SHIP_SPOT.normal);
    if (dist > SHIP_INTERACT_RADIUS) return;
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
    showOverlay(
      'Spaceship Repaired!',
      'You gathered all 3 keys and got the ship running again.\n\nKeep exploring the planet — launch is coming in a future update.',
      'Nice!',
      () => {},
    );
    announce('Spaceship repaired. Great work out there.');
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
    if (!finderCollected) addBlip(KEY_FINDER_SPOT.normal, '#ffb347', 5);
    if (finderCollected) {
      for (const key of keyPickups) if (!key.collected) addBlip(key.normal, '#7be0ff', 4);
    }
    for (const drone of drones) addBlip(drone.mesh.position.clone().normalize(), '#ff4d4d', 4);

    minimap.draw(blips);
  }

  function updateDrones(dt, elapsed) {
    for (const drone of drones) {
      const t = elapsed * drone.speed + drone.phase;
      drone.mesh.position.copy(drone.center)
        .multiplyScalar(PLANET_RADIUS + drone.altitude)
        .addScaledVector(drone.u, Math.cos(t) * drone.orbitRadius)
        .addScaledVector(drone.v, Math.sin(t) * drone.orbitRadius);
      for (const r of drone.mesh.userData.rotors) r.rotation.y += dt * 30;
      drone.mesh.userData.blinkLight.visible = Math.floor(elapsed * 4) % 2 === 0;
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

  return {
    scene,
    update(dt, elapsed, camera) {
      // Each gameplay step re-checks state since updateMovement can flip it
      // to 'dead' mid-frame (drone contact) and the rest should stop too.
      if (state === 'playing') updateMovement(dt);
      if (state === 'playing') updateFinderPickup();
      if (state === 'playing') updateKeyPickups(dt);
      if (state === 'playing') updateShipInteract();
      astronaut.update(dt);
      updateCamera(dt, camera);
      updateShadowLight();
      updateSatellite(elapsed);
      updateClouds(dt);
      updateEarth(dt);
      updateDrones(dt, elapsed);
      updateWind(elapsed);
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
    placeShip(scene, obstacles),
    placeHouses(scene, obstacles),
    placeVolcano(scene, obstacles),
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

async function placeShip(scene, obstacles) {
  try {
    const ship = await loadDecoration('/assets/spaceship.glb', 6.5);
    placeOnSurface(ship, SHIP_SPOT.normal, EMBED.ship);
    orientToNormal(ship, SHIP_SPOT.normal, 0);
    scene.add(ship);
    obstacles.push({ normal: SHIP_SPOT.normal.clone(), radius: SHIP_BLOCK_RADIUS });
  } catch (err) {
    console.error('Failed to place spaceship:', err);
    flashToast('Spaceship model failed to load — see browser console (F12).', 5000);
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
