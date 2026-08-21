import * as THREE from 'three';
import { createStarfield } from '../entities.js';
import { loadDecoration } from '../game/models.js';
import { hideHud } from '../game/hud.js';
import { consumeInteractPress } from '../game/input.js';
import { playArrivalSting, playMusicTheme, playAmbience } from '../game/audio.js';

// A reusable "flying between worlds" cutscene, used for every inter-level
// transition except the ground-level liftoff (which lives inside
// ascentScene.js since it needs that scene's own gameplay handoff). The ship
// stays in its known-good upright pose (same as the ground/ascent scenes)
// and only gets safe *relative* rotations (yaw, roll, bob) layered on top —
// the camera orbiting around it, plus the two background bodies drifting
// past, are what sell the motion. Engine flame positions are real, measured
// off the source mesh (see TURBINE_LOCAL_POSITIONS below), not guessed.
const SHIP_HEIGHT = 3.4;
const ORBIT_RADIUS_NEAR = 6.5;
const ORBIT_RADIUS_FAR = 10;
const ORBIT_HEIGHT_NEAR = 1.6;
const ORBIT_HEIGHT_FAR = 3.4;
const ORBIT_SWEEP = Math.PI * 0.55; // total angle the camera arcs through over the whole cutscene

const FLYBY_SIDE_DIST = 9;

const PULLBACK_RADIUS_NEAR = 3;
const PULLBACK_RADIUS_FAR = 13;
const PULLBACK_HEIGHT_NEAR = 0.6;
const PULLBACK_HEIGHT_FAR = 4.5;

const FROM_DIR = new THREE.Vector3(-0.35, -0.12, 0.92).normalize();
const TO_DIR = new THREE.Vector3(0.4, 0.15, -0.9).normalize();
const FROM_START_DIST = 34;
const FROM_END_DIST = 260;
const TO_START_DIST = 420;
const TO_END_DIST = 55;

// The four engine nacelle mount points, measured directly off spaceship.glb's
// own vertex data rather than guessed: the raw mesh has two tight, symmetric
// vertex clusters per side (an upper-outer and a lower-inner one) sitting at
// the extreme end of the hull's Z range — exactly where a 4-nacelle cluster
// would sit. Coordinates below are those cluster centroids, converted from
// the raw glTF's local space into loadDecoration's normalized/scaled space
// (centered on X/Z, feet at Y=0, scaled to SHIP_HEIGHT) so they line up with
// the wrapper this scene actually adds to the world.
// Pulled in toward the ship's local origin (rather than sitting exactly on
// the measured mount points) — the raw mount points read as too far out and
// too spread apart once actually visible in-game, so this scales all four
// toward center: closer to the hull and closer to each other at once. Then
// nudged back (further -Z, more trailing distance off the hull) and up (+Y,
// a lot) as a uniform offset on top of that — tuned against how it actually
// looked in-game, not re-derived from the mesh.
const TURBINE_PULL_IN = 0.6;
const TURBINE_OFFSET = new THREE.Vector3(0, 1.0, -0.5);
const TURBINE_LOCAL_POSITIONS = [
  new THREE.Vector3(-2.13, 2.64, -1.21).multiplyScalar(TURBINE_PULL_IN).add(TURBINE_OFFSET),
  new THREE.Vector3(-1.70, 0.08, -1.38).multiplyScalar(TURBINE_PULL_IN).add(TURBINE_OFFSET),
  new THREE.Vector3(2.13, 2.64, -1.21).multiplyScalar(TURBINE_PULL_IN).add(TURBINE_OFFSET),
  new THREE.Vector3(1.70, 0.08, -1.38).multiplyScalar(TURBINE_PULL_IN).add(TURBINE_OFFSET),
];

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

// The cluster sits at the hull's Z-minimum extreme, so the exhaust trails
// further in -Z (continuing past the mesh edge) rather than back into it.
function createTurbineFlame() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.9 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.58, 10), mat);
  flame.rotation.x = -Math.PI / 2;
  return flame;
}

function makeBodyTexture(baseColor, accentColor) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = accentColor;
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 3 + Math.random() * 16;
    ctx.globalAlpha = 0.12 + Math.random() * 0.28;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

function createTravelBody(radius, baseColor, accentColor) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    map: makeBodyTexture(baseColor, accentColor), roughness: 0.9, metalness: 0.05,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat));
  const atmoMat = new THREE.MeshBasicMaterial({
    color: baseColor, transparent: true, opacity: 0.12, side: THREE.BackSide,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.04, 32, 32), atmoMat));
  return group;
}

function ensureCaption() {
  let el = document.getElementById('travel-caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'travel-caption';
    el.style.cssText = `
      position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%);
      color: #eaf6ff; text-align: center; pointer-events: none; z-index: 20;
      text-shadow: 0 2px 10px rgba(0,0,0,0.85); letter-spacing: 0.5px;
    `;
    document.body.appendChild(el);
  }
  return el;
}

function setCaption(el, label) {
  el.innerHTML = `
    <div style="font-size: 20px; font-weight: 700;">${label}</div>
    <div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">Press E to skip</div>
  `;
}

// fromLabel/toLabel: shown in the caption ("Departing X" / "Approaching Y").
// fromColor/fromAccent, toColor/toAccent: hex strings for the two backdrop
// bodies' base + speckle-detail colors. shotStyle picks the camera's
// choreography so back-to-back transitions don't all feel identical:
//   'orbit'    - camera arcs in a continuous curve around the ship.
//   'flyby'    - camera swoops side-to-side past the ship, then tucks in behind.
//   'pullback' - camera starts tight on the ship and eases straight back into a wide shot.
export async function createTravelCutscene({
  fromLabel = 'the last stop',
  toLabel = 'destination',
  fromColor = '#3d5a80',
  fromAccent = '#22314a',
  toColor = '#8fa0aa',
  toAccent = '#5c6670',
  duration = 6,
  shotStyle = 'orbit',
  musicTheme = null,
  onComplete,
} = {}) {
  hideHud();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040d);
  scene.fog = new THREE.Fog(0x02040d, 90, 500);

  scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(30, 60, 40);
  scene.add(sun);

  const stars = createStarfield(6000, 700, true);
  stars.material.fog = false;
  scene.add(stars);

  const fromBody = createTravelBody(24, fromColor, fromAccent);
  scene.add(fromBody);

  const toBody = createTravelBody(32, toColor, toAccent);
  scene.add(toBody);

  const ship = await loadDecoration('/assets/spaceship.glb', SHIP_HEIGHT);
  const turbineFlames = TURBINE_LOCAL_POSITIONS.map((pos) => {
    const flame = createTurbineFlame();
    flame.position.copy(pos);
    ship.add(flame);
    return flame;
  });
  scene.add(ship);

  const caption = ensureCaption();
  setCaption(caption, `Departing ${fromLabel}`);

  let elapsed = 0;
  let midCaptionShown = false;
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    caption.remove();
    onComplete?.();
  }

  const camTarget = new THREE.Vector3();

  // 'orbit': a single continuous arc around the ship, pulling back/up over
  // the run — a slow, stately reveal.
  function updateOrbitCamera(t, et, elapsedTime, camera) {
    const angle = t * ORBIT_SWEEP;
    const radius = THREE.MathUtils.lerp(ORBIT_RADIUS_NEAR, ORBIT_RADIUS_FAR, et);
    const height = THREE.MathUtils.lerp(ORBIT_HEIGHT_NEAR, ORBIT_HEIGHT_FAR, et);
    const shake = (1 - et) * 0.04;
    camera.position.set(
      ship.position.x + Math.sin(angle) * radius + Math.sin(elapsedTime * 9) * shake,
      ship.position.y + height + Math.cos(elapsedTime * 7) * shake,
      ship.position.z + Math.cos(angle) * radius,
    );
    camTarget.set(ship.position.x, ship.position.y + 0.4, ship.position.z);
    camera.lookAt(camTarget);
  }

  // 'flyby': camera swoops from one side to the other past the ship (a fast
  // pass), then peels back to a trailing position for the arrival — more
  // energetic than the orbit shot.
  function updateFlybyCamera(t, et, elapsedTime, camera) {
    if (t < 0.5) {
      const st = easeInOutCubic(t / 0.5);
      camera.position.set(
        ship.position.x + THREE.MathUtils.lerp(-FLYBY_SIDE_DIST, FLYBY_SIDE_DIST, st),
        ship.position.y + 1.5,
        ship.position.z + THREE.MathUtils.lerp(1, -3, st),
      );
    } else {
      const st = easeInOutCubic((t - 0.5) / 0.5);
      camera.position.set(
        ship.position.x + THREE.MathUtils.lerp(FLYBY_SIDE_DIST, -4, st),
        ship.position.y + THREE.MathUtils.lerp(1.5, 2.6, st),
        ship.position.z + THREE.MathUtils.lerp(-3, 8, st),
      );
    }
    camTarget.set(ship.position.x, ship.position.y + 0.4, ship.position.z);
    camera.lookAt(camTarget);
  }

  // 'pullback': starts tight and close on the ship, eases straight back
  // (no orbiting) into a wide shot — reads as "and the journey continues."
  function updatePullbackCamera(t, et, elapsedTime, camera) {
    const radius = THREE.MathUtils.lerp(PULLBACK_RADIUS_NEAR, PULLBACK_RADIUS_FAR, et);
    const height = THREE.MathUtils.lerp(PULLBACK_HEIGHT_NEAR, PULLBACK_HEIGHT_FAR, et);
    camera.position.set(ship.position.x + 1.5, ship.position.y + height, ship.position.z + radius);
    camTarget.set(ship.position.x, ship.position.y + 0.2, ship.position.z);
    camera.lookAt(camTarget);
  }

  function update(dt, elapsedTime, camera) {
    if (finished) return;
    if (consumeInteractPress()) {
      finish();
      return;
    }

    elapsed += dt;
    const t = Math.min(1, elapsed / duration);
    const et = easeInOutCubic(t);

    // Departure body recedes into the distance; destination body closes in
    // and grows to fill the view by the end — both drift along fixed
    // directions rather than "toward/away from the ship's nose" so this
    // works regardless of the ship model's actual forward axis.
    fromBody.position.copy(FROM_DIR).multiplyScalar(FROM_START_DIST + et * (FROM_END_DIST - FROM_START_DIST));
    toBody.position.copy(TO_DIR).multiplyScalar(TO_START_DIST + et * (TO_END_DIST - TO_START_DIST));

    // Ship holds near the origin with a light idle bob/roll/yaw so it reads
    // as flying rather than pasted in place.
    ship.position.set(Math.sin(elapsedTime * 0.6) * 0.35, 1 + Math.cos(elapsedTime * 0.5) * 0.2, 0);
    ship.rotation.y += dt * 0.12;
    ship.rotation.z = Math.sin(elapsedTime * 0.7) * 0.06;
    for (let i = 0; i < turbineFlames.length; i++) {
      turbineFlames[i].scale.setScalar(0.8 + Math.sin(elapsedTime * 22 + i * 1.7) * 0.15);
    }

    if (shotStyle === 'flyby') updateFlybyCamera(t, et, elapsedTime, camera);
    else if (shotStyle === 'pullback') updatePullbackCamera(t, et, elapsedTime, camera);
    else updateOrbitCamera(t, et, elapsedTime, camera);

    if (t > 0.5 && !midCaptionShown) {
      midCaptionShown = true;
      setCaption(caption, `Approaching ${toLabel}`);
      playArrivalSting();
      // Crossfade into the destination's music/ambience partway through the
      // flight, so the mood has already shifted by the time you land instead
      // of switching abruptly the instant the next scene loads.
      if (musicTheme) {
        playMusicTheme(musicTheme);
        playAmbience(musicTheme);
      }
    }

    if (t >= 1) finish();
  }

  return { scene, update, destroy() { caption.remove(); } };
}
