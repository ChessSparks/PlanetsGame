import * as THREE from 'three';
import {
  createRocket, createEarth, createStarfield, createFuelCell,
  createBird, createDrone, createSatellite, createOrbitRing,
} from '../entities.js';
import { keys } from '../game/input.js';
import { setBarLabels, setTopBar, setBottomBar, setCellsCount, showOverlay } from '../game/hud.js';

const ORBIT_ALTITUDE = 140;
const EARTH_RADIUS = 300;
const LANE_HALF_WIDTH = 7;

const THRUST_ACCEL = 26;
const GRAVITY = 10;
const STRAFE_ACCEL = 46;
const STRAFE_DAMPING = 6;
const MAX_STRAFE_SPEED = 14;
const MAX_FALL_SPEED = -22;

const FUEL_MAX = 100;
const THRUST_FUEL_DRAIN = 14;
const FUEL_CELL_GIVE = 16;
const HIT_PENALTY = 25;
const INVULN_TIME = 1.2;

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
  { type: 'satellite', x: 4, y: 100 }, { type: 'fuel', x: 3, y: 102 },
  { type: 'satellite', x: 0, y: 112 }, { type: 'fuel', x: -3, y: 116 },
  { type: 'satellite', x: -4, y: 122 }, { type: 'fuel', x: 0, y: 128 },
];
const TOTAL_FUEL_CELLS = LEVEL_LAYOUT.filter((e) => e.type === 'fuel').length;

export function createAscentScene({ startFuel = FUEL_MAX, onRestart } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050f);
  scene.fog = new THREE.Fog(0x02050f, 60, 260);

  scene.add(new THREE.AmbientLight(0x8899bb, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(40, 80, 30);
  scene.add(sun);

  scene.add(createStarfield());

  const earth = createEarth(EARTH_RADIUS);
  earth.position.set(0, -EARTH_RADIUS, 0);
  scene.add(earth);

  const padMat = new THREE.MeshStandardMaterial({ color: 0x555a66, metalness: 0.3, roughness: 0.7 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 0.6, 24), padMat);
  pad.position.set(0, -0.3, 0);
  scene.add(pad);

  const orbitRing = createOrbitRing(LANE_HALF_WIDTH + 3);
  orbitRing.position.y = ORBIT_ALTITUDE;
  scene.add(orbitRing);

  const rocket = createRocket();
  rocket.position.set(0, 1.3, 0);
  scene.add(rocket);

  const player = {
    x: 0, y: 1.3, vx: 0, vy: 0,
    fuel: startFuel, cellsCollected: 0, invulnTimer: 0,
  };

  const activeEntities = [];
  function buildLevel() {
    for (const e of activeEntities) scene.remove(e.mesh);
    activeEntities.length = 0;
    for (const def of LEVEL_LAYOUT) {
      let mesh;
      if (def.type === 'fuel') mesh = createFuelCell();
      else if (def.type === 'bird') mesh = createBird();
      else if (def.type === 'drone') mesh = createDrone();
      else if (def.type === 'satellite') mesh = createSatellite();
      mesh.position.set(def.x, def.y, 0);
      scene.add(mesh);
      activeEntities.push({ mesh, def, alive: true, baseX: def.x, baseY: def.y });
    }
  }
  buildLevel();

  let state = 'playing';

  function resetGame(newStartFuel) {
    player.x = 0; player.y = 1.3; player.vx = 0; player.vy = 0;
    player.fuel = newStartFuel ?? FUEL_MAX; player.cellsCollected = 0; player.invulnTimer = 0;
    rocket.position.set(0, 1.3, 0);
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
    if (player.y < 1.3) { player.y = 1.3; player.vy = Math.max(0, player.vy * 0.2); }

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

      if (def.type === 'bird') {
        mesh.position.x = baseX + Math.sin(elapsed * 3 + baseY) * 1.4;
        mesh.position.y = baseY + Math.sin(elapsed * 6 + baseY) * 0.3;
        const flap = Math.sin(elapsed * 14 + baseY);
        mesh.userData.wingL.rotation.z = flap * 0.6;
        mesh.userData.wingR.rotation.z = -flap * 0.6;
      } else if (def.type === 'drone') {
        mesh.position.x = baseX + Math.sin(elapsed * 1.1 + baseY) * 2.2;
        for (const r of mesh.userData.rotors) r.rotation.y += dt * 30;
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
      showOverlay(
        'Orbit Reached! \u{1F680}',
        `Mission complete.\nFuel cells collected: ${player.cellsCollected} / ${TOTAL_FUEL_CELLS}\nFuel remaining: ${Math.round(player.fuel)}%`,
        'Play Again',
        () => { onRestart ? onRestart() : resetGame(startFuel); },
      );
    } else if (player.fuel <= 0 && player.y <= 1.35 && player.vy <= 0) {
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
      if (state === 'playing') {
        updatePlayer(dt);
        updateEntities(dt, elapsed);
        updateHUD();
        checkEndConditions();
      }
      updateCamera(dt, camera);
    },
  };
}
