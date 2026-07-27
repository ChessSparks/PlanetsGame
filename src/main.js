import * as THREE from 'three';
import { initInput } from './game/input.js';
import {
  showOverlay, showHud, hideKeysDisplay, setLoadingProgress, hideLoadingScreen, showLoadingScreen,
} from './game/hud.js';
import { createGroundScene } from './scenes/groundScene.js';
import { createAscentScene } from './scenes/ascentScene.js';
import { createMoonScene } from './scenes/moonScene.js';

// All GLTFLoader instances in the game (character.js, models.js) use the
// default manager, so this tracks every model fetch across the whole app.
THREE.DefaultLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  setLoadingProgress(itemsTotal > 0 ? (itemsLoaded / itemsTotal) * 100 : 0);
};

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1200);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

initInput();

let activeScene = null;
const clock = new THREE.Clock();

// Scenes that own DOM elements outside the canvas (currently: the minimap)
// expose destroy() to clean those up — without this, switching planets left
// every previous scene's minimap div stacked in the page, frozen showing
// its last-drawn blips ("remains of the previous planet's map data").
function teardownActiveScene() {
  activeScene?.destroy?.();
  activeScene = null;
}

async function startAscentPhase(fuelCellsCollected, totalFuelCells) {
  const startFuel = Math.min(100, 60 + Math.round((fuelCellsCollected / totalFuelCells) * 40));
  hideKeysDisplay();
  showHud();
  camera.position.set(0, -1.7, 15);
  teardownActiveScene();
  // The ship model is already cached from the ground scene (same URL), so
  // this resolves near-instantly in practice — still awaited properly since
  // createAscentScene is async now that it loads that model itself.
  const ascent = await createAscentScene({
    startFuel,
    onRestart: () => startGroundPhase(),
    onOrbitReached: () => startMoonPhase().catch((err) => {
      console.error('Failed to start moon phase:', err);
      showOverlay(
        'Something went wrong',
        `The moon scene failed to load:\n${err.message}\n\nCheck the browser console for details.`,
        'Retry',
        () => startMoonPhase().catch((e) => console.error(e)),
      );
    }),
  });
  activeScene = ascent;
  hideLoadingScreen();
  showOverlay(
    'Liftoff!',
    `Rocket repaired and fueled (${fuelCellsCollected}/${totalFuelCells} fuel cells collected on the ground).\nStarting fuel: ${startFuel}%\n\nW/↑: Thrust    A/D or ←/→: Strafe`,
    'Launch',
    () => {},
  );
}

async function startMoonPhase() {
  camera.position.set(0, 12, 6.5);
  teardownActiveScene();
  const moon = await createMoonScene({
    onComplete: () => startGroundPhase(),
  });
  activeScene = moon;
  hideLoadingScreen();
}

async function startGroundPhase() {
  camera.position.set(0, 25, 6.5);
  teardownActiveScene();
  const ground = await createGroundScene({
    onLaunch: (collected, total) => startAscentPhase(collected, total).catch((err) => {
      console.error('Failed to start ascent phase:', err);
      showOverlay(
        'Something went wrong',
        `The ascent scene failed to load:\n${err.message}\n\nCheck the browser console for details.`,
        'Retry',
        () => startGroundPhase().catch((e) => console.error(e)),
      );
    }),
  });
  activeScene = ground;
  hideLoadingScreen();
}

// Dev-only convenience so testing the moon/ascent phases doesn't require
// replaying the whole game from the crash cutscene every time. Ascent
// launched directly gets a full tank (no ground-collected fuel cells to
// compute a percentage from).
const PHASE_STARTERS = {
  ground: () => startGroundPhase(),
  ascent: () => startAscentPhase(1, 1),
  moon: () => startMoonPhase(),
};

function launchPhase(name) {
  showLoadingScreen();
  PHASE_STARTERS[name]().catch((err) => {
    console.error(`Failed to start ${name} phase:`, err);
    hideLoadingScreen();
    showOverlay(
      'Something went wrong',
      `The ${name} scene failed to load:\n${err.message}\n\nCheck the browser console for details.`,
      'Retry',
      () => launchPhase(name),
    );
  });
}

// A small always-present hamburger button (top-left) instead of a blocking
// startup screen — the game boots normally, and this menu is available at
// any time to jump straight to another phase for testing.
function initDevMenu() {
  const toggle = document.createElement('button');
  toggle.id = 'dev-menu-toggle';
  toggle.type = 'button';
  toggle.textContent = '☰';
  toggle.style.cssText = `
    position: fixed; top: 14px; left: 14px; z-index: 70;
    width: 36px; height: 36px; border-radius: 8px; border: 1px solid rgba(120,180,255,0.35);
    background: rgba(6,14,32,0.75); color: #eaf6ff; font-size: 18px; cursor: pointer;
  `;
  document.body.appendChild(toggle);

  const panel = document.createElement('div');
  panel.id = 'dev-menu-panel';
  panel.style.cssText = `
    position: fixed; top: 56px; left: 14px; z-index: 70; display: none;
    flex-direction: column; gap: 6px; padding: 10px;
    background: rgba(6,14,32,0.92); border: 1px solid rgba(120,180,255,0.35);
    border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.4);
  `;
  panel.innerHTML = `
    <div style="font-size: 10px; letter-spacing: 2px; opacity: 0.55; text-transform: uppercase; padding: 2px 6px;">Dev — jump to</div>
    <button data-phase="ground" type="button" class="dev-menu-btn">Ground</button>
    <button data-phase="ascent" type="button" class="dev-menu-btn">Ascent</button>
    <button data-phase="moon" type="button" class="dev-menu-btn">Moon</button>
  `;
  document.body.appendChild(panel);

  for (const btn of panel.querySelectorAll('.dev-menu-btn')) {
    btn.style.cssText = `
      font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 6px;
      border: none; cursor: pointer; background: rgba(255,255,255,0.1); color: #eaf6ff;
      text-align: left;
    `;
    btn.addEventListener('click', () => {
      panel.style.display = 'none';
      launchPhase(btn.dataset.phase);
    });
  }

  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== toggle) panel.style.display = 'none';
  });
}

initDevMenu();
startGroundPhase().catch((err) => {
  console.error('Failed to start ground phase:', err);
  hideLoadingScreen();
  showOverlay(
    'Something went wrong',
    `The planet scene failed to load:\n${err.message}\n\nCheck the browser console for details.`,
    'Retry',
    () => startGroundPhase().catch((e) => console.error(e)),
  );
});

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();

  // Captured once per frame: several phase transitions (e.g. "Mission
  // Complete" -> ground) set the module-level activeScene to null as a
  // synchronous side effect of update() itself (before awaiting the next
  // scene's assets). Re-reading the shared variable for render() after that
  // would crash on a null .scene; the local copy stays valid for this frame
  // regardless of what update() does to the outer variable.
  const scene = activeScene;
  if (scene) {
    scene.update(dt, elapsed, camera);
    renderer.render(scene.scene, camera);
  }
}

animate();
