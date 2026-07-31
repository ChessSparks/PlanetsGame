import * as THREE from 'three';
import {
  createPlanetGround, createStarfield, createFuelCell,
  createBird, createSatellite, createOrbitRing,
} from '../entities.js';
import { loadDecoration } from '../game/models.js';
import { orientToNormal } from '../game/planet.js';
import { loadDroneTemplate, cloneDrone } from '../game/droneModel.js';
import { keys, consumeInteractPress } from '../game/input.js';
import {
  setBarLabels, setTopBar, setBottomBar, setCellsCount, showOverlay, flashToast, announceObjective,
} from '../game/hud.js';
import { speak } from '../game/voice.js';
import {
  playMusicTheme, playAmbience, playIgnitionSting, playOrbitSting,
} from '../game/audio.js';

const ORBIT_ALTITUDE = 140;
// The actual ground level's planet radius (see groundScene.js's own
// PLANET_RADIUS) — this is the same small world the player just explored,
// not a generic huge Earth stand-in, so it shrinks into a distant ball
// quickly as you climb rather than behaving like a real-scale planet.
const PLANET_RADIUS = 32;
const LANE_HALF_WIDTH = 7;

// Reuses the same spaceship model (and normalization convention — feet/base
// at local y=0) as the ground scene, so it's recognizably "your ship" in
// both phases instead of a generic placeholder rocket.
const SHIP_HEIGHT = 3.6;
const SHIP_COLLISION_RADIUS = 1.3;
const GROUND_Y = 0; // ship's base sits flush with the pad's top surface

const THRUST_ACCEL = 26;
const GRAVITY = 10;
const STRAFE_ACCEL = 46;
const STRAFE_DAMPING = 6;
const MAX_STRAFE_SPEED = 14;
const MAX_FALL_SPEED = -22;

// A short scripted liftoff plays before the player gets control — the ship
// eases up from the pad to LIFTOFF_HANDOFF_Y on its own, then hands off
// exactly LIFTOFF_HANDOFF_VY of upward velocity so normal gravity/thrust
// physics picks up smoothly instead of the ship suddenly "starting" mid-air.
const LIFTOFF_DURATION = 4.2;
const LIFTOFF_HANDOFF_Y = 6;
const LIFTOFF_HANDOFF_VY = 9;

const FUEL_MAX = 100;
const THRUST_FUEL_DRAIN = 14;
const FUEL_CELL_GIVE = 16;
const HIT_PENALTY = 25;
const INVULN_TIME = 1.2;

// Density/danger ramps UP toward orbit instead of thinning out — the old
// layout's last third was just slow-moving satellites, which made the
// final stretch to orbit the easiest part of the level instead of the
// climax. Drones now persist (and get denser) all the way to the top,
// woven in around the satellites rather than replaced by them.
const LEVEL_LAYOUT = [
  { type: 'fuel', x: 2, y: 8 }, { type: 'fuel', x: -3, y: 14 },
  { type: 'bird', x: -4, y: 12 }, { type: 'bird', x: 5, y: 18 },
  { type: 'fuel', x: 4, y: 22 }, { type: 'bird', x: -2, y: 26 },
  { type: 'fuel', x: -2, y: 30 }, { type: 'bird', x: 3, y: 34 },
  { type: 'fuel', x: 0, y: 40 }, { type: 'bird', x: -5, y: 42 },
  { type: 'drone', x: 4, y: 48 }, { type: 'fuel', x: 3, y: 50 },
  { type: 'drone', x: -4, y: 56 }, { type: 'fuel', x: -4, y: 62 },
  { type: 'drone', x: 0, y: 64 }, { type: 'drone', x: 5, y: 72 },
  { type: 'fuel', x: 2, y: 74 }, { type: 'drone', x: -3, y: 80 },
  { type: 'satellite', x: -3, y: 90 }, { type: 'fuel', x: -2, y: 88 },
  { type: 'drone', x: 3, y: 94 }, { type: 'drone', x: -5, y: 97 },
  { type: 'satellite', x: 4, y: 100 }, { type: 'fuel', x: 3, y: 102 },
  { type: 'drone', x: -2, y: 106 }, { type: 'bird', x: 5, y: 109 },
  { type: 'satellite', x: 0, y: 112 }, { type: 'fuel', x: -3, y: 116 },
  { type: 'drone', x: 4, y: 117 }, { type: 'drone', x: -4, y: 119 },
  { type: 'satellite', x: -4, y: 122 }, { type: 'fuel', x: 0, y: 128 },
  { type: 'drone', x: 2, y: 124 }, { type: 'drone', x: -3, y: 132 },
  { type: 'fuel', x: 0, y: 136 },
];
const TOTAL_FUEL_CELLS = LEVEL_LAYOUT.filter((e) => e.type === 'fuel').length;

// A simple procedural exhaust cone attached under the loaded ship — the
// source model has no built-in engine effect, so this substitutes for the
// old placeholder rocket's flame the same way (a cone flipped to taper
// away from the hull, toggled visible while thrusting).
function createThrustFlame() {
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.9 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 12), flameMat);
  flame.position.y = -0.35;
  flame.rotation.x = Math.PI;
  return flame;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

// Places an object on the local dome of the small planet directly beneath
// the pad, given a flat (dx, dz) offset from the pad's center — the sphere
// is tangent to the pad at the world origin, so the dome's height falls off
// as sqrt(radius^2 - r^2) the further out you go. `embed` sinks the object
// slightly into the surface the same way every other scene's placeOnSurface
// does, so bases don't visibly float above the ground.
function placeOnPlanet(object, dx, dz, embed = 0) {
  const r = Math.sqrt(dx * dx + dz * dz);
  const y = -PLANET_RADIUS + Math.sqrt(Math.max(0, PLANET_RADIUS * PLANET_RADIUS - r * r)) - embed;
  object.position.set(dx, y, dz);
  const normal = new THREE.Vector3(dx, y + PLANET_RADIUS, dz).normalize();
  orientToNormal(object, normal, Math.random() * Math.PI * 2);
}

// Same asset files groundScene.js scatters across its forest — reused here
// (not placeholders) so the cluster around the pad is recognizably "the
// same kind of place" the player just walked through.
const LAUNCH_SITE_FLORA = [
  { url: '/assets/pine.glb', height: [4.0, 6.5] },
  { url: '/assets/rock.glb', height: [0.8, 1.8] },
  { url: '/assets/bush.glb', height: [0.6, 1.0] },
  { url: '/assets/fern.glb', height: [0.4, 0.7] },
];
const LAUNCH_SITE_FLORA_COUNT = 16;

async function scatterLaunchSiteLandmarks(scene) {
  const tasks = [];
  for (let i = 0; i < LAUNCH_SITE_FLORA_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * 15; // clear of the pad, within a natural-looking cluster
    const def = LAUNCH_SITE_FLORA[Math.floor(Math.random() * LAUNCH_SITE_FLORA.length)];
    tasks.push((async () => {
      try {
        const [minH, maxH] = def.height;
        const height = minH + Math.random() * (maxH - minH);
        const instance = await loadDecoration(def.url, height);
        placeOnPlanet(instance, Math.cos(angle) * dist, Math.sin(angle) * dist, 0.15);
        scene.add(instance);
      } catch (err) {
        console.error(`Failed to place ${def.url} near the pad:`, err);
      }
    })());
  }

  // A house and the volcano — both distinctive enough from the ground level
  // to be recognized at a glance even shrinking away below.
  tasks.push((async () => {
    try {
      const house = await loadDecoration('/assets/house.glb', 6.0);
      placeOnPlanet(house, 13, -11, 0.4);
      scene.add(house);
    } catch (err) {
      console.error('Failed to place house near the pad:', err);
    }
  })());
  tasks.push((async () => {
    try {
      const volcano = await loadDecoration('/assets/volcano.glb', 8.5);
      placeOnPlanet(volcano, -22, 14, 0.3);
      scene.add(volcano);
    } catch (err) {
      console.error('Failed to place volcano near the pad:', err);
    }
  })());

  await Promise.all(tasks);
}

// Sky/fog fixed at "dark space" the whole climb, even right off the pad,
// gave zero visual sense of actually leaving atmosphere — SPACE_COLOR is
// the scene's original fixed color, ATMOSPHERE_COLOR is a bright daytime
// sky for low altitude, and updateSky() below blends between them (plus
// widens the fog range as the "air" thins out) based on player.y.
const ATMOSPHERE_COLOR = new THREE.Color(0x6bb7e8);
const ATMOSPHERE_FOG_COLOR = new THREE.Color(0x8fd0ff);
const SPACE_COLOR = new THREE.Color(0x02050f);

export async function createAscentScene({ startFuel = FUEL_MAX, onRestart, onOrbitReached } = {}) {
  playMusicTheme('ascent');
  playAmbience('ascent');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050f);
  scene.fog = new THREE.Fog(0x02050f, 60, 260);

  scene.add(new THREE.AmbientLight(0x8899bb, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(40, 80, 30);
  scene.add(sun);

  // Fog only reaches 260 units out, but the default starfield spread puts
  // points 450-900 units away — exempt stars from fog so they aren't fully
  // washed out to the fog color before reaching the camera.
  const ascentStars = createStarfield();
  ascentStars.material.fog = false;
  scene.add(ascentStars);

  // The same planet the player just launched from (groundScene's own
  // createPlanetGround, not a generic mismatched blue "Earth" sphere), at
  // its actual small radius — tangent to the pad at y=0, so its surface
  // reads as the actual ground curving away beneath you, shrinking into a
  // distant ball as you climb rather than behaving like a real-scale planet.
  const earth = createPlanetGround(PLANET_RADIUS);
  earth.position.set(0, -PLANET_RADIUS, 0);
  scene.add(earth);

  const earthAtmo = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS * 1.015, 48, 48),
    new THREE.MeshBasicMaterial({
      color: 0x6bb7e8, transparent: true, opacity: 0.1, side: THREE.BackSide,
    }),
  );
  earthAtmo.position.copy(earth.position);
  scene.add(earthAtmo);

  const padMat = new THREE.MeshStandardMaterial({ color: 0x555a66, metalness: 0.3, roughness: 0.7 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 0.6, 24), padMat);
  pad.position.set(0, -0.3, 0);
  scene.add(pad);

  // A handful of the ground level's own decorations (same asset files, not
  // placeholders) scattered around the pad — the point of showing the
  // actual small planet instead of a generic backdrop is that this reads as
  // leaving the specific place the player just explored. Fire-and-forget:
  // a slow/failed fetch here shouldn't block the launch from being playable.
  scatterLaunchSiteLandmarks(scene).catch((err) => {
    console.error('Failed to scatter launch-site landmarks:', err);
  });

  const orbitRing = createOrbitRing(LANE_HALF_WIDTH + 3);
  orbitRing.position.y = ORBIT_ALTITUDE;
  scene.add(orbitRing);

  const rocket = await loadDecoration('/assets/spaceship.glb', SHIP_HEIGHT);
  rocket.userData.radius = SHIP_COLLISION_RADIUS;
  const flame = createThrustFlame();
  rocket.add(flame);
  rocket.userData.flame = flame;
  rocket.position.set(0, GROUND_Y, 0);
  scene.add(rocket);

  const player = {
    x: 0, y: GROUND_Y, vx: 0, vy: 0,
    fuel: startFuel, cellsCollected: 0, invulnTimer: 0,
  };

  // Loaded once up front (buildLevel() below reruns synchronously on every
  // retry via resetGame(), so it can't itself await a network fetch) —
  // cloneDrone() is plain THREE.Object3D.clone(), safe to call from there.
  const droneTemplate = await loadDroneTemplate();

  const activeEntities = [];
  function buildLevel() {
    for (const e of activeEntities) scene.remove(e.mesh);
    activeEntities.length = 0;
    for (const def of LEVEL_LAYOUT) {
      let mesh;
      if (def.type === 'fuel') mesh = createFuelCell();
      else if (def.type === 'bird') mesh = createBird();
      else if (def.type === 'drone') mesh = cloneDrone(droneTemplate);
      else if (def.type === 'satellite') mesh = createSatellite();
      mesh.position.set(def.x, def.y, 0);
      scene.add(mesh);
      activeEntities.push({ mesh, def, alive: true, baseX: def.x, baseY: def.y });
    }
  }
  buildLevel();

  let state = 'liftoff';
  let liftoffElapsed = 0;
  let atmosphereBeatFired = false;
  flashToast('Liftoff! (Press E to skip)', LIFTOFF_DURATION * 1000);
  playIgnitionSting();

  const skyColor = new THREE.Color();
  const fogColor = new THREE.Color();
  function updateSky() {
    const t = THREE.MathUtils.clamp(player.y / ORBIT_ALTITUDE, 0, 1);
    const eased = t * t; // lingers in "still atmosphere" a bit before clearing fast near the top
    skyColor.copy(ATMOSPHERE_COLOR).lerp(SPACE_COLOR, eased);
    scene.background.copy(skyColor);
    fogColor.copy(ATMOSPHERE_FOG_COLOR).lerp(SPACE_COLOR, eased);
    scene.fog.color.copy(fogColor);
    scene.fog.far = THREE.MathUtils.lerp(90, 260, eased); // hazy near the pad, clear once the air's thinned out

    if (!atmosphereBeatFired && t > 0.5) {
      atmosphereBeatFired = true;
      announceObjective('Breaking atmosphere — hold steady.');
      speak('Breaking atmosphere. Hold steady.');
    }
  }

  function resetGame(newStartFuel) {
    player.x = 0; player.y = GROUND_Y; player.vx = 0; player.vy = 0;
    player.fuel = newStartFuel ?? FUEL_MAX; player.cellsCollected = 0; player.invulnTimer = 0;
    atmosphereBeatFired = false;
    rocket.position.set(0, GROUND_Y, 0);
    rocket.rotation.set(0, 0, 0);
    buildLevel();
    state = 'playing';
  }

  setBarLabels('FUEL', 'ALTITUDE');
  setCellsCount(0, TOTAL_FUEL_CELLS);

  function updatePlayer(dt) {
    if (keys.up && player.fuel > 0) {
      player.vy += THRUST_ACCEL * dt;
      player.fuel = Math.max(0, player.fuel - THRUST_FUEL_DRAIN * dt);
      rocket.userData.flame.visible = true;
    } else {
      rocket.userData.flame.visible = false;
    }
    player.vy -= GRAVITY * dt;
    player.vy = Math.max(MAX_FALL_SPEED, player.vy);

    let strafeInput = 0;
    if (keys.left) strafeInput -= 1;
    if (keys.right) strafeInput += 1;

    if (strafeInput !== 0) {
      player.vx += strafeInput * STRAFE_ACCEL * dt;
      player.vx = THREE.MathUtils.clamp(player.vx, -MAX_STRAFE_SPEED, MAX_STRAFE_SPEED);
    } else {
      const damp = STRAFE_DAMPING * dt;
      if (Math.abs(player.vx) <= damp) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * damp;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    player.x = THREE.MathUtils.clamp(player.x, -LANE_HALF_WIDTH, LANE_HALF_WIDTH);
    if (player.y < GROUND_Y) { player.y = GROUND_Y; player.vy = Math.max(0, player.vy * 0.2); }

    rocket.position.set(player.x, player.y, 0);
    rocket.rotation.z = THREE.MathUtils.lerp(rocket.rotation.z, -player.vx * 0.05, 0.15);

    if (player.invulnTimer > 0) {
      player.invulnTimer -= dt;
      rocket.visible = Math.floor(player.invulnTimer * 12) % 2 === 0;
    } else {
      rocket.visible = true;
    }
  }

  function updateEntities(dt, elapsed) {
    for (const ent of activeEntities) {
      if (!ent.alive) continue;
      const { mesh, def, baseX, baseY } = ent;
      // A real difficulty ramp, not just more obstacles higher up — birds
      // and drones sweep faster and wider the closer they are to orbit, so
      // the same obstacle type gets harder to read/dodge as you climb
      // instead of staying identical the whole level.
      const altitudeRamp = 1 + (baseY / ORBIT_ALTITUDE) * 0.7;

      if (def.type === 'bird') {
        mesh.position.x = baseX + Math.sin(elapsed * 3 * altitudeRamp + baseY) * 1.4 * altitudeRamp;
        mesh.position.y = baseY + Math.sin(elapsed * 6 + baseY) * 0.3;
        const flap = Math.sin(elapsed * 14 + baseY);
        mesh.userData.wingL.rotation.z = flap * 0.6;
        mesh.userData.wingR.rotation.z = -flap * 0.6;
      } else if (def.type === 'drone') {
        mesh.position.x = baseX + Math.sin(elapsed * 1.1 * altitudeRamp + baseY) * 2.2 * altitudeRamp;
        mesh.userData.blinkLight.visible = Math.floor(elapsed * 4) % 2 === 0;
      } else if (def.type === 'satellite') {
        mesh.position.x = baseX + Math.sin(elapsed * 0.4 + baseY) * 1.0;
        mesh.rotation.y += dt * 0.3;
      } else if (def.type === 'fuel') {
        mesh.rotation.y += dt * 1.6;
        mesh.rotation.x += dt * 0.8;
        mesh.position.y = baseY + Math.sin(elapsed * 2 + baseY) * 0.3;
      }

      if (player.y - baseY > 6) {
        ent.alive = false;
        scene.remove(mesh);
        continue;
      }

      const dx = mesh.position.x - player.x;
      const dy = mesh.position.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const collideDist = mesh.userData.radius + rocket.userData.radius;

      if (dist < collideDist) {
        if (def.type === 'fuel') {
          player.fuel = Math.min(FUEL_MAX, player.fuel + FUEL_CELL_GIVE);
          player.cellsCollected += 1;
          ent.alive = false;
          scene.remove(mesh);
        } else if (player.invulnTimer <= 0) {
          player.fuel = Math.max(0, player.fuel - HIT_PENALTY);
          player.invulnTimer = INVULN_TIME;
          player.vy = Math.min(player.vy, -4);
        }
      }
    }
  }

  // Shot A (0-35%): a close, low ignition shot near the engine as the ship
  // first lifts off the pad. Shot B (35-100%): bows out into a wide pull-back
  // — the whole point of showing the actual small planet instead of a
  // generic backdrop is wasted if the camera never pulls back far enough to
  // see it — then eases back in to land exactly on the standard chase-cam
  // framing updateCamera() uses, timed for zero camera pop at the handoff.
  function updateLiftoff(dt, elapsed, camera) {
    if (consumeInteractPress()) {
      liftoffElapsed = LIFTOFF_DURATION;
    } else {
      liftoffElapsed += dt;
    }
    const t = Math.min(1, liftoffElapsed / LIFTOFF_DURATION);
    const et = easeInOutCubic(t);

    player.y = LIFTOFF_HANDOFF_Y * et;
    rocket.position.set(player.x, player.y, 0);
    rocket.userData.flame.visible = true;
    rocket.userData.flame.scale.setScalar(0.9 + Math.sin(elapsed * 30) * 0.15);
    rocket.rotation.z = Math.sin(elapsed * 6) * 0.02 * (1 - t);

    if (t < 0.35) {
      const st = t / 0.35;
      camera.position.set(
        THREE.MathUtils.lerp(1.8, 1.2, st),
        // Was -0.6 at st=0 — below the pad's top surface (GROUND_Y=0) and
        // right at/inside the pad mesh's underside (it spans y -0.6 to 0),
        // which put the opening shot's camera underground looking up through
        // the platform. 0.25 keeps the low, close-to-the-engine framing
        // without dipping below the pad.
        THREE.MathUtils.lerp(0.25, 0.4, st),
        THREE.MathUtils.lerp(3.2, 4.5, st),
      );
      camera.lookAt(0, player.y + 0.6, 0);
    } else {
      const st = easeInOutCubic((t - 0.35) / 0.65);
      const mt = 1 - st;
      // Quadratic Bezier through a pulled-back, elevated control point —
      // bows the shot out wide and high mid-transition (revealing the pad,
      // the scattered landmarks, and the planet's curve) before easing back
      // in to land precisely on updateCamera()'s framing at st=1.
      const fromPos = new THREE.Vector3(1.2, 0.4, 4.5);
      const revealPos = new THREE.Vector3(player.x * 0.4 + 10, player.y + 14, 26);
      const targetPos = new THREE.Vector3(player.x * 0.4, player.y - 3, 15);
      camera.position.set(0, 0, 0)
        .addScaledVector(fromPos, mt * mt)
        .addScaledVector(revealPos, 2 * mt * st)
        .addScaledVector(targetPos, st * st);

      const lookFrom = new THREE.Vector3(0, player.y + 0.6, 0);
      const lookReveal = new THREE.Vector3(player.x * 0.4, -6, 0);
      const lookTo = new THREE.Vector3(player.x * 0.4, player.y + 6, 0);
      const lookTarget = new THREE.Vector3(0, 0, 0)
        .addScaledVector(lookFrom, mt * mt)
        .addScaledVector(lookReveal, 2 * mt * st)
        .addScaledVector(lookTo, st * st);
      camera.lookAt(lookTarget);
    }

    if (t >= 1) {
      state = 'playing';
      player.vy = LIFTOFF_HANDOFF_VY;
    }
  }

  function updateCamera(dt, camera) {
    const targetPos = new THREE.Vector3(player.x * 0.4, player.y - 3, 15);
    camera.position.lerp(targetPos, 1 - Math.pow(0.001, dt));
    const lookTarget = new THREE.Vector3(player.x * 0.4, player.y + 6, 0);
    camera.lookAt(lookTarget);
  }

  function updateHUD() {
    setTopBar((player.fuel / FUEL_MAX) * 100);
    setBottomBar((player.y / ORBIT_ALTITUDE) * 100);
    setCellsCount(player.cellsCollected, TOTAL_FUEL_CELLS);
  }

  function checkEndConditions() {
    if (state !== 'playing') return;
    if (player.y >= ORBIT_ALTITUDE) {
      state = 'won';
      playOrbitSting();
      showOverlay(
        'Orbit Reached! \u{1F680}',
        `Fuel cells collected: ${player.cellsCollected} / ${TOTAL_FUEL_CELLS}\nFuel remaining: ${Math.round(player.fuel)}%\n\nSetting a course for the moon.`,
        'Continue',
        () => { onOrbitReached ? onOrbitReached() : (onRestart ? onRestart() : resetGame(startFuel)); },
      );
    } else if (player.fuel <= 0 && player.y <= GROUND_Y + 0.05 && player.vy <= 0) {
      state = 'lost';
      showOverlay(
        'Mission Failed',
        'Out of fuel before reaching orbit.\nCollect more fuel cells along the way!',
        'Retry',
        () => resetGame(startFuel),
      );
    }
  }

  return {
    scene,
    update(dt, elapsed, camera) {
      if (state === 'liftoff') {
        updateLiftoff(dt, elapsed, camera);
        updateSky();
        return;
      }
      if (state === 'playing') {
        updatePlayer(dt);
        updateEntities(dt, elapsed);
        updateHUD();
        checkEndConditions();
      }
      updateSky();
      updateCamera(dt, camera);
    },
  };
}
