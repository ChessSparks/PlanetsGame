import * as THREE from 'three';
import {
  createMoonGround, createStarfield, createEarth, createFuelCell,
} from '../entities.js';
import { loadAstronaut } from '../game/character.js';
import { loadDecoration } from '../game/models.js';
import { createPlanetWalker, fibonacciSphere, orientToNormal } from '../game/planet.js';
import { keys, consumeInteractPress, consumeJumpPress } from '../game/input.js';
import {
  hideHud, showOverlay, flashToast, announceObjective,
} from '../game/hud.js';
import { speak } from '../game/voice.js';
import { createMinimap } from '../game/minimap.js';
import { playPickupChime } from '../game/audio.js';
import { showStarChart } from '../game/starChartPuzzle.js';

const MOON_RADIUS = 14;

const WALK_SPEED = 3.0;
const RUN_SPEED = 5.8;
const BACKWARD_SPEED = 1.8;
const TURN_SPEED = 2.4;

// Noticeably floatier than the ground scene's jump — a "low gravity moon
// bounce" rather than the same arc scaled down.
const JUMP_SPEED = 5.5;
const GRAVITY = 6;
const JUMP_SQUASH_REFERENCE = 0.6;
const JUMP_SQUASH_AMOUNT = 0.08;

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

const SHIP_SPOT = { normal: sph(80, 0), clear: 0.3 };
// Must clear SHIP_BLOCK_RADIUS + PLAYER_COLLISION_RADIUS (3.45 units) with
// real margin — spawning inside the ship's obstacle radius means the very
// first hitsObstacle() check reverts every move back to the same spot,
// permanently freezing the player.
const SPAWN_SPOT = { normal: sph(55, 40), clear: 0.14 };
// Crystals stay off-scene (invisible, uncollectible) until the map console
// is solved — same "hidden until unlocked" convention as groundScene's keys.
const CRYSTAL_SPOTS = [
  { normal: sph(10, 40) },
  { normal: sph(-20, 100) },
  { normal: sph(30, -80) },
  { normal: sph(-10, -150) },
  { normal: sph(50, 160) },
];
// Well clear of ship/spawn/crystals (checked: nearest is ~18.7 units away)
// so it can't reproduce the spawn-inside-an-obstacle freeze from before.
const MAP_CONSOLE_SPOT = { normal: sph(-30, -30), clear: 0.2 };

const CLEAR_ZONES = [
  SHIP_SPOT, SPAWN_SPOT, MAP_CONSOLE_SPOT,
  ...CRYSTAL_SPOTS.map((c) => ({ normal: c.normal, clear: 0.09 })),
];

const ROCK_COUNT = 90;
const PLAYER_COLLISION_RADIUS = 0.45;
const SHIP_BLOCK_RADIUS = 3.0;
const SHIP_INTERACT_RADIUS = 4.6;
const MAP_CONSOLE_BLOCK_RADIUS = 1.1;
const MAP_CONSOLE_INTERACT_RADIUS = 2.8;
const CRYSTAL_PICKUP_RADIUS = 1.2;
const EMBED = { ship: 0.5, rock: 0.12, console: 0.3 };

function tangentBasis(normal) {
  const hint = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(hint, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

function placeOnSurface(object, normal, embed) {
  object.position.copy(normal).multiplyScalar(MOON_RADIUS - embed);
}

function hoverPlace(object, normal, height) {
  object.position.copy(normal).multiplyScalar(MOON_RADIUS + height);
  orientToNormal(object, normal, 0);
}

function inClearZone(normal) {
  for (const zone of CLEAR_ZONES) {
    if (normal.angleTo(zone.normal) < zone.clear) return true;
  }
  return false;
}

// jumpHeight is purely a visual offset added on top of the walker's surface
// position, so without this, a low-gravity moon jump could arc high over a
// rock and still get blocked as if standing on the ground. Rocks are short
// enough to actually clear with the moon's floaty jump, so they're marked
// jumpable with a per-rock clear height; the ship/console stay solid no
// matter how high you jump.
function hitsObstacle(normal, obstacles, jumpHeight) {
  for (const obs of obstacles) {
    if (obs.jumpable && jumpHeight > obs.clearHeight) continue;
    const arc = MOON_RADIUS * normal.angleTo(obs.normal);
    if (arc < PLAYER_COLLISION_RADIUS + obs.radius) return true;
  }
  return false;
}

// The rock's top surface, not just an empty threshold to clear — jumping
// into a rock's footprint without enough height to clear it lands you
// standing on top of it rather than falling through to the base surface.
function getGroundBump(normal, obstacles) {
  let bump = 0;
  for (const obs of obstacles) {
    if (!obs.jumpable) continue;
    const arc = MOON_RADIUS * normal.angleTo(obs.normal);
    if (arc < obs.radius && obs.height > bump) bump = obs.height;
  }
  return bump;
}

function createCrystal() {
  const gem = createFuelCell();
  gem.userData.core.material.color.set(0x8fd6ff);
  gem.userData.core.material.emissive.set(0x3f8fe0);
  gem.userData.radius = 0.8;
  return gem;
}

// An ancient-looking beacon that gates the star chart puzzle — a hexagonal
// pedestal with a glowing core and a thin ring, built procedurally since
// there's no dedicated console asset.
function createMapConsole() {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, metalness: 0.6, roughness: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.4, 6), baseMat);
  base.position.y = 0.7;
  group.add(base);

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x8fd6ff, emissive: 0x3f8fe0, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.2,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), coreMat);
  core.position.y = 1.7;
  group.add(core);
  group.userData.core = core;

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32), coreMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.7;
  group.add(ring);
  group.userData.ring = ring;

  return group;
}

export async function createMoonScene({ onComplete } = {}) {
  hideHud();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x02020a, 90, 230);

  scene.add(new THREE.AmbientLight(0x333a4a, 0.55));
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.6);
  sun.position.set(60, 90, 40);
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
  const shadowLightOffset = new THREE.Vector3(60, 90, 40).normalize().multiplyScalar(30);

  scene.add(createStarfield(2400, 900, false));

  // Home planet — the same distant point glimpsed from the crash site,
  // now huge and close: the payoff for the whole ground-then-orbit arc.
  const home = createEarth(30);
  home.position.set(130, 55, -90);
  scene.add(home);

  const moon = createMoonGround(MOON_RADIUS);
  scene.add(moon);

  let walker = createPlanetWalker(SPAWN_SPOT.normal.clone(), new THREE.Vector3(0, 0, -1));
  const obstacles = [];
  let jumpVelocity = 0;
  let jumpHeight = 0;

  const astronaut = await loadAstronaut();
  scene.add(astronaut.object3D);
  astronaut.fadeTo('Idle', { duration: 0 });

  const ship = await loadDecoration('/assets/spaceship.glb', 6.5);
  placeOnSurface(ship, SHIP_SPOT.normal, EMBED.ship);
  orientToNormal(ship, SHIP_SPOT.normal, 0);
  scene.add(ship);
  obstacles.push({ normal: SHIP_SPOT.normal.clone(), radius: SHIP_BLOCK_RADIUS });

  const mapConsole = createMapConsole();
  placeOnSurface(mapConsole, MAP_CONSOLE_SPOT.normal, EMBED.console);
  orientToNormal(mapConsole, MAP_CONSOLE_SPOT.normal, 0);
  scene.add(mapConsole);
  obstacles.push({ normal: MAP_CONSOLE_SPOT.normal.clone(), radius: MAP_CONSOLE_BLOCK_RADIUS });

  // Crystals are created up front but stay out of the scene (and off the
  // minimap) until the star chart puzzle is solved — spawnCrystals() below
  // adds them in, mirroring how groundScene hides keys until the finder
  // is picked up.
  const crystalPickups = CRYSTAL_SPOTS.map((spot) => {
    const mesh = createCrystal();
    hoverPlace(mesh, spot.normal, 1.0);
    return { mesh, normal: spot.normal, collected: false };
  });
  let crystalsCollected = 0;
  let mapSolved = false;

  function spawnCrystals() {
    for (const crystal of crystalPickups) scene.add(crystal.mesh);
  }

  // Scattered moon rocks load in the background — a single bad fetch can't
  // block the level from being playable.
  scatterMoonRocks(scene, obstacles);

  const minimap = createMinimap();

  let state = 'intro';

  function announce(text) {
    announceObjective(text);
    speak(text);
  }

  hideHud();
  showOverlay(
    'Touchdown',
    'Corthana: Landed. There\'s a console nearby giving off a strange resonance — might be able to pull a map of nearby crystal deposits out of it.\n\nThe ship\'s already flightworthy, for what it\'s worth. Whatever needs these crystals, it isn\'t her.\n\nLow gravity here, so jumps go a long way.\n\nW/↑: Walk   S/↓: Back   A/D: Turn   Shift: Run   Space: Jump   E: Interact',
    'Begin',
    () => {
      state = 'playing';
      announce('Objective: find the console and solve it to map the crystal deposits.');
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
    walker.moveForward(speed * dt, MOON_RADIUS);
    if (hitsObstacle(walker.normal, obstacles, jumpHeight)) {
      walker.normal.copy(prevNormal);
      walker.forward.copy(prevForward);
    }

    const newPos = walker.getPosition(MOON_RADIUS);
    const groundBump = getGroundBump(walker.normal, obstacles);

    if (consumeJumpPress() && jumpHeight <= groundBump) {
      jumpVelocity = JUMP_SPEED;
    }
    jumpVelocity -= GRAVITY * dt;
    jumpHeight += jumpVelocity * dt;
    if (jumpHeight < groundBump) {
      jumpHeight = groundBump;
      jumpVelocity = 0;
    }

    astronaut.object3D.position.copy(newPos).addScaledVector(walker.normal, jumpHeight);
    const orientQuat = walker.getOrientationQuaternion();
    if (astronaut.modelForwardOffset) {
      orientQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), astronaut.modelForwardOffset));
    }
    astronaut.object3D.quaternion.copy(orientQuat);
    const airborne = jumpHeight > groundBump + 0.01;
    if (airborne) {
      astronaut.fadeTo('Run', { duration: 0.12 });
      const squashT = Math.min(1, (jumpHeight - groundBump) / JUMP_SQUASH_REFERENCE);
      astronaut.object3D.scale.y = 1 - JUMP_SQUASH_AMOUNT * squashT;
    } else {
      astronaut.fadeTo(anim, { duration: 0.2 });
      astronaut.object3D.scale.y = 1;
    }
  }

  function updateCrystalPickups(dt) {
    if (!mapSolved) return; // crystals aren't in the scene yet — nothing to check
    const playerPos = walker.getPosition(MOON_RADIUS);
    for (const crystal of crystalPickups) {
      if (crystal.collected) continue;
      crystal.mesh.rotateY(dt * 1.8);
      if (crystal.mesh.position.distanceTo(playerPos) < CRYSTAL_PICKUP_RADIUS) {
        crystal.collected = true;
        scene.remove(crystal.mesh);
        crystalsCollected += 1;
        playPickupChime();
        astronaut.fadeTo('Interact', {
          duration: 0.15, loop: false,
          onFinished: () => astronaut.fadeTo('Idle', { duration: 0.2 }),
        });
        if (crystalsCollected >= crystalPickups.length) {
          announce('All crystal deposits collected. Objective: return to the ship and press E.');
        } else {
          flashToast(`Crystal collected! (${crystalsCollected}/${crystalPickups.length})`, 2000);
        }
      }
    }
  }

  // A single consumeInteractPress() per frame is shared across both
  // interactables (ship and console) — calling it twice would silently drop
  // whichever check ran second, since the press is one-shot.
  function updateInteract() {
    if (!consumeInteractPress()) return;

    const shipDist = MOON_RADIUS * walker.normal.angleTo(SHIP_SPOT.normal);
    if (shipDist <= SHIP_INTERACT_RADIUS) {
      handleShipInteract();
      return;
    }

    const consoleDist = MOON_RADIUS * walker.normal.angleTo(MAP_CONSOLE_SPOT.normal);
    if (consoleDist <= MAP_CONSOLE_INTERACT_RADIUS) {
      handleConsoleInteract();
    }
  }

  function handleShipInteract() {
    if (!mapSolved) {
      flashToast('Find the console and map the crystal deposits first.', 2400);
      return;
    }
    if (crystalsCollected < crystalPickups.length) {
      flashToast(`Need ${crystalPickups.length - crystalsCollected} more crystal(s) before liftoff.`, 2200);
      return;
    }
    state = 'done';
    showOverlay(
      'Mission Complete',
      'You gathered every crystal deposit and made it back to the ship.\n\nCorthana: That\'s everything we came for. Well done.',
      'Play Again',
      () => onComplete?.(),
    );
  }

  function handleConsoleInteract() {
    if (mapSolved) {
      flashToast('The console has nothing left to show you.', 1800);
      return;
    }
    state = 'puzzle';
    showStarChart(
      () => {
        mapSolved = true;
        state = 'playing';
        spawnCrystals();
        playPickupChime();
        flashToast('Deposits located!', 2200);
        announce('Deposits located. Whatever these are for, it isn\'t the ship — she\'s already flightworthy. Objective: collect the crystal deposits.');
      },
      () => {
        state = 'playing';
      },
    );
  }

  function updateMinimap() {
    const right = new THREE.Vector3().crossVectors(walker.normal, walker.forward).normalize();
    const blips = [];

    function addBlip(normal, color, size, shape) {
      const arc = MOON_RADIUS * walker.normal.angleTo(normal);
      const toTarget = normal.clone().sub(walker.normal.clone().multiplyScalar(walker.normal.dot(normal)));
      if (toTarget.lengthSq() < 1e-8) {
        blips.push({ dx: 0, dy: 0, color, size, shape });
        return;
      }
      toTarget.normalize();
      blips.push({ dx: toTarget.dot(right) * arc, dy: toTarget.dot(walker.forward) * arc, color, size, shape });
    }

    addBlip(SHIP_SPOT.normal, '#7bffb0', 7, 'ship');
    if (!mapSolved) {
      addBlip(MAP_CONSOLE_SPOT.normal, '#8fd6ff', 5);
    } else {
      for (const crystal of crystalPickups) if (!crystal.collected) addBlip(crystal.normal, '#8fd6ff', 4);
    }

    minimap.draw(blips);
  }

  function updateCamera(dt, camera) {
    const pos = walker.getPosition(MOON_RADIUS);
    const camTarget = pos.clone()
      .addScaledVector(walker.forward, -CAM_DISTANCE)
      .addScaledVector(walker.normal, CAM_HEIGHT);
    camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt));
    camera.up.copy(walker.normal);
    const lookTarget = pos.clone().addScaledVector(walker.normal, LOOK_HEIGHT);
    camera.lookAt(lookTarget);
  }

  function updateShadowLight() {
    const pos = walker.getPosition(MOON_RADIUS);
    sun.position.copy(pos).add(shadowLightOffset);
    sun.target.position.copy(pos);
  }

  return {
    scene,
    update(dt, elapsed, camera) {
      if (state === 'playing') {
        updateMovement(dt);
        updateCrystalPickups(dt);
        updateInteract();
      }
      astronaut.update(dt);
      updateCamera(dt, camera);
      updateShadowLight();
      home.rotation.y += dt * 0.02;
      if (!mapSolved) {
        mapConsole.userData.ring.rotation.z += dt * 0.6;
        const pulse = 1 + Math.sin(elapsed * 2.4) * 0.15;
        mapConsole.userData.core.scale.setScalar(pulse);
      }
      updateMinimap();
    },
    destroy() {
      minimap.destroy();
    },
  };
}

async function scatterMoonRocks(scene, obstacles) {
  const points = fibonacciSphere(ROCK_COUNT);
  await Promise.all(points.map(async (point) => {
    if (inClearZone(point)) return;
    try {
      const height = 0.5 + Math.random() * 1.1;
      const rock = await loadDecoration('/assets/rock.glb', height);
      placeOnSurface(rock, point, EMBED.rock);
      orientToNormal(rock, point, Math.random() * Math.PI * 2);
      scene.add(rock);
      obstacles.push({
        normal: point.clone(), radius: height * 0.5, height, jumpable: true, clearHeight: height * 0.7,
      });
    } catch (err) {
      console.error('Failed to place moon rock:', err);
    }
  }));
}
