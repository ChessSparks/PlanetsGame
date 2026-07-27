import * as THREE from 'three';
import {
  createForgeGround, createStarfield, createSentry, createSpire, createSun,
  createIndustrialBuilding, createStreetPad, createControlTower,
} from '../entities.js';
import { loadAstronaut } from '../game/character.js';
import { loadDecoration } from '../game/models.js';
import { createPlanetWalker, fibonacciSphere, orientToNormal } from '../game/planet.js';
import { keys, consumeInteractPress, consumeJumpPress } from '../game/input.js';
import {
  hideHud, showOverlay, showChoiceOverlay, flashToast, announceObjective,
} from '../game/hud.js';
import { speak } from '../game/voice.js';
import { createMinimap } from '../game/minimap.js';
import { playDroneAlert, playPickupChime } from '../game/audio.js';
import { showCircuitPuzzle } from '../game/circuitPuzzle.js';
import { showSlidingPuzzle } from '../game/puzzle.js';

// The biggest level in the game — the client's homeworld. A long, dangerous
// walk from the landing site to the spire, through an industrial district,
// guarded by sentries that only turn hostile once you've made your choice.
const PLANET_RADIUS = 32;

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

const SUN_DIRECTION = new THREE.Vector3(60, 90, 40).normalize();

function sph(latDeg, lonDeg) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  );
}

const SHIP_SPOT = { normal: sph(60, 0), clear: 0.3 };
// Checked: 7.33 units from the ship, clear of SHIP_BLOCK_RADIUS +
// PLAYER_COLLISION_RADIUS (3.45) with real margin — see the moon scene's
// spawn-freeze postmortem for why this matters.
const SPAWN_SPOT = { normal: sph(50, 15), clear: 0.14 };
// ~67 units of arc from the ship — a real journey, the whole point of this
// being the largest level.
const SPIRE_SPOT = { normal: sph(-30, 100), clear: 0.4 };
// ~10-18 units from spawn/ship — an early, safe-to-reach waypoint since it
// gates knowing where the spire even is.
const MAP_CONSOLE_SPOT = { normal: sph(35, 30), clear: 0.2 };
// Roughly between the spire and the ship — a logical waypoint on the way
// back once the sentries have been turned loose.
const CONTROL_TOWER_SPOT = { normal: sph(-5, 65), clear: 0.25 };

const SENTRY_PATROLS = [
  { center: sph(40, 25), orbitRadius: 4.5, altitude: 2.5, speed: 0.5, phase: 0 },
  { center: sph(10, 50), orbitRadius: 5.0, altitude: 2.8, speed: 0.45, phase: 1.5 },
  { center: sph(-10, 70), orbitRadius: 4.0, altitude: 2.6, speed: 0.55, phase: 3.0 },
  { center: sph(-30, 40), orbitRadius: 5.5, altitude: 3.0, speed: 0.4, phase: 4.5 },
  { center: sph(20, 90), orbitRadius: 4.5, altitude: 2.7, speed: 0.5, phase: 2.2 },
];

// Industrial districts — clusters of solid buildings on paved lots, scattered
// across the route rather than one literal grid (much simpler to place
// correctly on a sphere than true perpendicular streets, while still reading
// as "urban/industrial" rather than empty wasteland).
const DISTRICT_CENTERS = [
  sph(45, 15), sph(20, 45), sph(-15, 55), sph(-25, 80), sph(15, 75), sph(-45, 15),
  sph(35, 60), sph(-35, 90), sph(5, 20),
];
const DISTRICT_RADIUS = 13;
const BUILDINGS_PER_DISTRICT = 14;

const CLEAR_ZONES = [
  SHIP_SPOT, SPAWN_SPOT, SPIRE_SPOT, MAP_CONSOLE_SPOT, CONTROL_TOWER_SPOT,
];

const ROCK_COUNT = 120;
const PLAYER_COLLISION_RADIUS = 0.45;
const SHIP_BLOCK_RADIUS = 3.0;
const SHIP_INTERACT_RADIUS = 4.6;
const SPIRE_BLOCK_RADIUS = 5.2;
const SPIRE_INTERACT_RADIUS = 7.5;
const MAP_CONSOLE_BLOCK_RADIUS = 1.1;
const MAP_CONSOLE_INTERACT_RADIUS = 2.8;
const CONTROL_TOWER_BLOCK_RADIUS = 2.4;
const CONTROL_TOWER_INTERACT_RADIUS = 4.5;
const EMBED = { ship: 0.5, rock: 0.15, spire: 0.4, console: 0.3, tower: 0.3, building: 0.1 };

const SENTRY_HAZARD_RADIUS = 1.4;
const SENTRY_AGGRO_RADIUS = 10;
const SENTRY_DISENGAGE_RADIUS = 15;
const SENTRY_CHASE_ALTITUDE = 1.0;
const SENTRY_CHASE_SPEED = 5.4; // slower than RUN_SPEED — outrunning them is always possible
const SENTRY_MAX_CHASE_SECONDS = 9;
const SENTRY_PATROL_CATCH_SPEED = 9;

function tangentBasis(normal) {
  const hint = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(hint, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

function placeOnSurface(object, normal, embed) {
  object.position.copy(normal).multiplyScalar(PLANET_RADIUS - embed);
}

function inClearZone(normal) {
  for (const zone of CLEAR_ZONES) {
    if (normal.angleTo(zone.normal) < zone.clear) return true;
  }
  return false;
}

function hitsObstacle(normal, obstacles) {
  for (const obs of obstacles) {
    const arc = PLANET_RADIUS * normal.angleTo(obs.normal);
    if (arc < PLAYER_COLLISION_RADIUS + obs.radius) return true;
  }
  return false;
}

function orbitPosition(sentry, elapsed, target = new THREE.Vector3()) {
  const t = elapsed * sentry.speed + sentry.phase;
  return target.copy(sentry.center)
    .multiplyScalar(PLANET_RADIUS + sentry.altitude)
    .addScaledVector(sentry.u, Math.cos(t) * sentry.orbitRadius)
    .addScaledVector(sentry.v, Math.sin(t) * sentry.orbitRadius);
}

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

// An industrial computer terminal — deliberately NOT the moon's glowing-
// crystal-orb beacon aesthetic: a boxy metal kiosk with a tilted CRT-green
// screen, an antenna, and a blinking status light.
function createMapBeacon() {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, metalness: 0.6, roughness: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.0), baseMat);
  base.position.y = 0.55;
  group.add(base);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.5, roughness: 0.5 });
  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 0.15), frameMat);
  screenFrame.position.set(0, 1.5, 0.3);
  screenFrame.rotation.x = -0.5;
  group.add(screenFrame);

  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0a2a24, emissive: 0x1fffbc, emissiveIntensity: 1.0, metalness: 0.1, roughness: 0.3,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.75), screenMat);
  screen.position.set(0, 1.5, 0.38);
  screen.rotation.x = -0.5;
  group.add(screen);
  group.userData.screen = screen;

  const antennaMat = new THREE.MeshStandardMaterial({ color: 0x44484e, metalness: 0.7, roughness: 0.3 });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), antennaMat);
  antenna.position.set(-0.55, 1.7, -0.3);
  group.add(antenna);

  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3344 });
  const beaconLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), beaconMat);
  beaconLight.position.set(-0.55, 2.3, -0.3);
  group.add(beaconLight);
  group.userData.beaconLight = beaconLight;

  return group;
}

export async function createClientWorldScene({ onDeliver, onRefuseEscape } = {}) {
  hideHud();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a1a16);
  scene.fog = new THREE.Fog(0x3a2018, 55, 170);

  scene.add(new THREE.AmbientLight(0x7a5850, 0.9));
  const sun = new THREE.DirectionalLight(0xffc59c, 2.0);
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

  // Denser and slightly bigger than the default — the lighter fog/sky here
  // (brightened per an earlier request) washes out small dim points more
  // than the other scenes' darker backgrounds do.
  const stars = createStarfield(3500, 700, false);
  stars.material.size = 1.9;
  stars.material.sizeAttenuation = true;
  scene.add(stars);

  const sunMesh = createSun(0xffc59c, 10);
  sunMesh.position.copy(SUN_DIRECTION).multiplyScalar(200);
  scene.add(sunMesh);

  const ground = createForgeGround(PLANET_RADIUS);
  scene.add(ground);

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

  const spire = createSpire();
  placeOnSurface(spire, SPIRE_SPOT.normal, EMBED.spire);
  orientToNormal(spire, SPIRE_SPOT.normal, 0);
  scene.add(spire);
  obstacles.push({ normal: SPIRE_SPOT.normal.clone(), radius: SPIRE_BLOCK_RADIUS });

  const mapBeacon = createMapBeacon();
  placeOnSurface(mapBeacon, MAP_CONSOLE_SPOT.normal, EMBED.console);
  orientToNormal(mapBeacon, MAP_CONSOLE_SPOT.normal, 0);
  scene.add(mapBeacon);
  obstacles.push({ normal: MAP_CONSOLE_SPOT.normal.clone(), radius: MAP_CONSOLE_BLOCK_RADIUS });

  const controlTower = createControlTower();
  placeOnSurface(controlTower, CONTROL_TOWER_SPOT.normal, EMBED.tower);
  orientToNormal(controlTower, CONTROL_TOWER_SPOT.normal, 0);
  scene.add(controlTower);
  obstacles.push({ normal: CONTROL_TOWER_SPOT.normal.clone(), radius: CONTROL_TOWER_BLOCK_RADIUS });

  const sentries = SENTRY_PATROLS.map((patrol) => {
    const mesh = createSentry();
    scene.add(mesh);
    return { ...patrol, mesh, ...tangentBasis(patrol.center), mode: 'patrol', chaseTime: 0 };
  });

  // Scattered ruins and building districts load in the background — a
  // single bad fetch can't block the level from being playable.
  scatterRuins(scene, obstacles);
  scatterDistricts(scene, obstacles);

  const minimap = createMinimap();

  let state = 'intro';
  let mapSolved = false;
  let choiceMade = false;
  let delivered = false;
  let sentriesActive = false;
  let sentriesDisabled = false;
  let lastElapsed = 0; // captured each frame so resetRun() can relocate sentries outside the normal update tick

  function announce(text) {
    announceObjective(text);
    speak(text);
  }

  showOverlay(
    'Hostile Ground',
    'Corthana: We\'re down. Sensors show a beacon nearby broadcasting local map data — find it before we go stumbling toward the spire blind.\n\nThe sentries haven\'t clocked us as a threat yet. Let\'s keep it that way for now.\n\nW/↑: Walk   S/↓: Back   A/D: Turn   Shift: Run   Space: Jump   E: Interact',
    'Begin',
    () => {
      state = 'playing';
      announce('Objective: find the map beacon.');
    },
  );

  function resetRun() {
    walker = createPlanetWalker(SPAWN_SPOT.normal.clone(), new THREE.Vector3(0, 0, -1));
    for (const sentry of sentries) {
      sentry.mode = 'patrol';
      sentry.chaseTime = 0;
      // Without this, a sentry that just killed you stays exactly where it
      // caught you — only its mode resets. If that happened near spawn, the
      // very next frame's hazard check sees it still standing on top of you
      // and kills you again immediately, over and over.
      orbitPosition(sentry, lastElapsed, sentry.mesh.position);
    }
    state = 'playing';
    announce('You were caught. Regrouping at the landing site.');
  }

  function handleDeath() {
    state = 'dead';
    showOverlay(
      'You Died',
      'A sentry caught you. Regrouping — try a different route in.',
      'Try Again',
      () => resetRun(),
    );
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

    // Sentries are inert until sentriesActive — no accidental touch-death
    // is possible before you've actually made your choice at the spire.
    if (sentriesActive) {
      const newPos = walker.getPosition(PLANET_RADIUS);
      for (const sentry of sentries) {
        if (newPos.distanceTo(sentry.mesh.position) < PLAYER_COLLISION_RADIUS + SENTRY_HAZARD_RADIUS) {
          handleDeath();
          return;
        }
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

  function activateSentries() {
    sentriesActive = true;
    for (const sentry of sentries) {
      sentry.mode = 'chase';
      sentry.chaseTime = 0;
    }
    flashToast('Alarms blare across the compound!', 2400);
    playDroneAlert();
  }

  function playReveal() {
    const screens = [
      {
        title: 'The Spire',
        body: 'The doors part before you reach them. Whoever runs this place already knows you\'re here.\n\nA voice resolves out of the static — pleasant, untroubled, entirely too relaxed for what it\'s about to say.',
      },
      {
        title: 'The Client',
        body: '"You found them. Good. I wasn\'t certain you would."\n\nCorthana, tight in your ear: "Ask them what the crystals are for. Ask them now."',
      },
      {
        title: 'What They\'re For',
        body: '"A weapon," the voice says, without hesitation, without shame. "Every non-plant life-sign in this system. Gone quietly, from orbit. No war. No warning."\n\nCorthana: "...The first planet. It was already quiet when we landed. Except for the plant life."\n\nThis isn\'t the first time they\'ve done this.',
      },
    ];
    let i = 0;
    function next() {
      if (i >= screens.length) {
        showChoiceOverlay(
          'Your Call',
          'The crystals are yours to give. Corthana is quiet, waiting for you to decide.',
          [
            { label: 'Hand over the crystals', danger: true, onSelect: () => resolveChoice(true) },
            { label: 'Refuse', onSelect: () => resolveChoice(false) },
          ],
        );
        return;
      }
      const s = screens[i++];
      showOverlay(s.title, s.body, 'Continue', next);
    }
    next();
  }

  function resolveChoice(handedOver) {
    delivered = handedOver;
    choiceMade = true;
    // Stays in 'dialogue' (not 'playing') through this transitional screen —
    // otherwise a player who interacts with the ship in the split second
    // before clicking Continue could reach handleShipInteract() (already
    // unlocked by choiceMade) before activateSentries() ever runs below,
    // skipping the sentries/control-tower act entirely.
    const screen = handedOver
      ? {
        title: 'Delivered',
        body: 'You hand over the case. The client doesn\'t thank you — there\'s no reason to. Payment clears before you\'ve even turned around.\n\nThen the alarms start. Apparently "no loose ends" applies to the courier too.',
      }
      : {
        title: 'Refused',
        body: 'You don\'t hand over anything. For a moment the voice just sounds mildly disappointed.\n\nThen the alarms start.',
      };
    showOverlay(screen.title, screen.body, 'Continue', () => {
      activateSentries();
      state = 'playing';
      announce('The control tower can shut the sentries down — or just run for the ship. Your call.');
    });
  }

  function resolveEnding() {
    state = 'ending';
    const screens = delivered
      ? [
        {
          title: 'Some Time Later',
          body: 'The relay lights up somewhere behind you, silent at this distance. You don\'t see it happen. You don\'t need to.\n\nSomewhere out there, another planet just went quiet.',
        },
      ]
      : [
        {
          title: 'Liftoff',
          body: 'You clear the hatch just as the first shots go wide. The ship claws up through their air, alarms screaming, and then — nothing. Just stars.',
        },
        {
          title: 'Aftermath',
          body: 'The crystals are still in the hold. Whatever they were worth, it wasn\'t worth this.\n\nCorthana, quietly: "For what it\'s worth — I think you did the right thing."',
        },
      ];
    const finalScreen = delivered
      ? {
        title: 'THE END',
        body: 'You got paid. You got the ship running. You got exactly what you came for.\n\nThat\'s the whole problem.',
      }
      : {
        title: 'THE END',
        body: 'You didn\'t deliver the weapon. You don\'t know what happens to the people who were counting on it. You didn\'t get paid.\n\nYou got to keep being someone you could live with.',
      };
    const onFinish = delivered ? onDeliver : onRefuseEscape;
    let i = 0;
    function next() {
      if (i >= screens.length) {
        showOverlay(finalScreen.title, finalScreen.body, 'Play Again', () => onFinish?.());
        return;
      }
      const s = screens[i++];
      showOverlay(s.title, s.body, 'Continue', next);
    }
    next();
  }

  function handleShipInteract() {
    if (!choiceMade) {
      flashToast('The ship isn\'t going anywhere until you\'ve dealt with the spire.', 2400);
      return;
    }
    resolveEnding();
  }

  function handleSpireInteract() {
    if (!mapSolved) {
      flashToast('No idea where you\'re even going — find the map beacon first.', 2400);
      return;
    }
    if (choiceMade) return;
    state = 'dialogue';
    playReveal();
  }

  function handleMapConsoleInteract() {
    if (mapSolved) {
      flashToast('The beacon has nothing left to show you.', 1800);
      return;
    }
    state = 'puzzle';
    showCircuitPuzzle(
      () => {
        mapSolved = true;
        state = 'playing';
        playPickupChime();
        flashToast('Spire location acquired!', 2200);
        announce('Spire location acquired. Objective: reach the spire.');
      },
      () => {
        state = 'playing';
      },
    );
  }

  function handleControlTowerInteract() {
    if (!sentriesActive) {
      flashToast('Nothing to override here yet.', 2000);
      return;
    }
    if (sentriesDisabled) {
      flashToast('Sentries are already offline.', 1800);
      return;
    }
    state = 'puzzle';
    showSlidingPuzzle(
      () => {
        sentriesDisabled = true;
        for (const sentry of sentries) {
          sentry.mode = 'patrol';
          sentry.chaseTime = 0;
        }
        state = 'playing';
        playPickupChime();
        flashToast('Sentries offline!', 2200);
        announce('Sentries offline. Get to the ship.');
      },
      () => {
        state = 'playing';
      },
      'Security Override',
      'Slide the tiles back into order (1-15) to override the sentry control grid.',
    );
  }

  // A single consumeInteractPress() per frame is shared across all four
  // interactables — calling it more than once would silently drop whichever
  // check ran later, since the press is one-shot.
  function updateInteract() {
    if (!consumeInteractPress()) return;

    const shipDist = PLANET_RADIUS * walker.normal.angleTo(SHIP_SPOT.normal);
    if (shipDist <= SHIP_INTERACT_RADIUS) { handleShipInteract(); return; }

    const spireDist = PLANET_RADIUS * walker.normal.angleTo(SPIRE_SPOT.normal);
    if (spireDist <= SPIRE_INTERACT_RADIUS) { handleSpireInteract(); return; }

    const consoleDist = PLANET_RADIUS * walker.normal.angleTo(MAP_CONSOLE_SPOT.normal);
    if (consoleDist <= MAP_CONSOLE_INTERACT_RADIUS) { handleMapConsoleInteract(); return; }

    const towerDist = PLANET_RADIUS * walker.normal.angleTo(CONTROL_TOWER_SPOT.normal);
    if (towerDist <= CONTROL_TOWER_INTERACT_RADIUS) handleControlTowerInteract();
  }

  const sentryChaseTarget = new THREE.Vector3();
  const sentryOrbitTarget = new THREE.Vector3();

  function updateSentries(dt, elapsed, playerPos, playerNormal) {
    for (const sentry of sentries) {
      if (sentriesActive && !sentriesDisabled) {
        const distToPlayer = sentry.mesh.position.distanceTo(playerPos);
        if (sentry.mode === 'patrol' && distToPlayer < SENTRY_AGGRO_RADIUS) {
          sentry.mode = 'chase';
          sentry.chaseTime = 0;
        } else if (sentry.mode === 'chase'
          && (distToPlayer > SENTRY_DISENGAGE_RADIUS || sentry.chaseTime > SENTRY_MAX_CHASE_SECONDS)) {
          sentry.mode = 'patrol';
        }
      }

      if (sentry.mode === 'chase') {
        sentry.chaseTime += dt;
        sentryChaseTarget.copy(playerNormal).multiplyScalar(PLANET_RADIUS + SENTRY_CHASE_ALTITUDE);
        moveToward(sentry.mesh.position, sentryChaseTarget, SENTRY_CHASE_SPEED * dt);
      } else {
        orbitPosition(sentry, elapsed, sentryOrbitTarget);
        moveToward(sentry.mesh.position, sentryOrbitTarget, SENTRY_PATROL_CATCH_SPEED * dt);
      }

      const chasing = sentry.mode === 'chase';
      for (const r of sentry.mesh.userData.rotors) r.rotation.y += dt * (chasing ? 50 : 30);
      sentry.mesh.userData.blinkLight.visible = Math.floor(elapsed * (chasing ? 8 : 4)) % 2 === 0;
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

    addBlip(SHIP_SPOT.normal, '#7bffb0', 7, 'ship');
    if (!mapSolved) {
      addBlip(MAP_CONSOLE_SPOT.normal, '#8fd6ff', 5);
    } else if (!choiceMade) {
      addBlip(SPIRE_SPOT.normal, '#ff5544', 6);
    }
    if (sentriesActive && !sentriesDisabled) {
      addBlip(CONTROL_TOWER_SPOT.normal, '#66ffcc', 5);
      for (const sentry of sentries) addBlip(sentry.mesh.position.clone().normalize(), '#ff4d4d', 5, 'drone');
    }

    minimap.draw(blips);
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
    const pos = walker.getPosition(PLANET_RADIUS);
    sun.position.copy(pos).add(shadowLightOffset);
    sun.target.position.copy(pos);
  }

  return {
    scene,
    update(dt, elapsed, camera) {
      lastElapsed = elapsed;
      if (state === 'playing') {
        updateMovement(dt);
        updateInteract();
      }
      astronaut.update(dt);
      updateCamera(dt, camera);
      updateShadowLight();
      updateSentries(dt, elapsed, walker.getPosition(PLANET_RADIUS), walker.normal);

      spire.userData.core.rotation.y += dt * 0.4;
      spire.userData.core.scale.setScalar(1 + Math.sin(elapsed * 1.6) * 0.12);

      if (!mapSolved) {
        mapBeacon.userData.screen.material.emissiveIntensity = 0.8 + Math.sin(elapsed * 2.4) * 0.4;
        mapBeacon.userData.beaconLight.visible = Math.floor(elapsed * 4) % 2 === 0;
      }

      controlTower.userData.dish.rotation.y += dt * 0.3;
      controlTower.userData.beacon.visible = Math.floor(elapsed * (sentriesDisabled ? 1.5 : 4)) % 2 === 0;

      updateMinimap();
    },
    destroy() {
      minimap.destroy();
    },
  };
}

async function scatterRuins(scene, obstacles) {
  const points = fibonacciSphere(ROCK_COUNT);
  await Promise.all(points.map(async (point) => {
    if (inClearZone(point)) return;
    try {
      const height = 0.6 + Math.random() * 1.6;
      const rock = await loadDecoration('/assets/rock.glb', height);
      placeOnSurface(rock, point, EMBED.rock);
      orientToNormal(rock, point, Math.random() * Math.PI * 2);
      scene.add(rock);
      obstacles.push({ normal: point.clone(), radius: height * 0.5 });
    } catch (err) {
      console.error('Failed to place ruin rock:', err);
    }
  }));
}

function scatterDistricts(scene, obstacles) {
  for (const center of DISTRICT_CENTERS) {
    const { u, v } = tangentBasis(center);
    for (let i = 0; i < BUILDINGS_PER_DISTRICT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * DISTRICT_RADIUS;
      const point = center.clone()
        .addScaledVector(u, (Math.cos(angle) * dist) / PLANET_RADIUS)
        .addScaledVector(v, (Math.sin(angle) * dist) / PLANET_RADIUS)
        .normalize();
      if (inClearZone(point)) continue;

      const width = 3 + Math.random() * 4;
      const depth = 3 + Math.random() * 4;
      const height = 3 + Math.random() * 5;

      const building = createIndustrialBuilding(width, depth, height);
      placeOnSurface(building, point, EMBED.building);
      orientToNormal(building, point, Math.random() * Math.PI * 2);
      scene.add(building);
      obstacles.push({ normal: point.clone(), radius: building.userData.radius });

      const pad = createStreetPad(width * 1.7, depth * 1.7);
      orientToNormal(pad, point, 0);
      pad.rotateX(-Math.PI / 2);
      placeOnSurface(pad, point, -0.03);
      scene.add(pad);
    }
  }
}
