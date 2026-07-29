import * as THREE from 'three';
import { initInput } from './game/input.js';
import { initTouchControls } from './game/touchControls.js';
import {
  showOverlay, showHud, hideKeysDisplay, setLoadingProgress, hideLoadingScreen, showLoadingScreen,
} from './game/hud.js';
import { showTitleScreen } from './game/titleScreen.js';
import { initSettingsMenu } from './game/settingsMenu.js';

// Each scene is dynamically imported at the point it's actually needed
// (see the phase-starter functions below) rather than statically up top —
// Vite splits each into its own chunk, so e.g. the client-world level's
// entire city-generation code never has to load for a player who never
// gets past the ground level. Previously this was one 670KB bundle loaded
// entirely up front regardless of how far the player actually got.

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
initTouchControls();

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

// Shared driver for the space-travel cutscene between levels — plays it,
// then hands off to whichever phase-starter should follow. Errors during
// the *next* phase's load are surfaced the same way every other transition
// in this file already does (a Retry overlay), so a flaky asset fetch after
// a cutscene doesn't just leave the player staring at a dead screen.
async function startTravelPhase(config, next) {
  teardownActiveScene();
  const { createTravelCutscene } = await import('./scenes/travelCutscene.js');
  const travel = await createTravelCutscene({
    ...config,
    onComplete: () => next().catch((err) => {
      console.error('Failed to continue after travel cutscene:', err);
      showOverlay(
        'Something went wrong',
        `The next scene failed to load:\n${err.message}\n\nCheck the browser console for details.`,
        'Retry',
        () => next().catch((e) => console.error(e)),
      );
    }),
  });
  activeScene = travel;
  hideLoadingScreen();
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
  const { createAscentScene } = await import('./scenes/ascentScene.js');
  const ascent = await createAscentScene({
    startFuel,
    onRestart: () => startGroundPhase(),
    onOrbitReached: () => startTravelPhase({
      fromLabel: 'Home Orbit',
      toLabel: 'the Moon',
      fromColor: '#4dd0ff',
      fromAccent: '#1c4a66',
      toColor: '#9aa3ad',
      toAccent: '#5c6068',
      shotStyle: 'orbit',
      musicTheme: 'moon',
    }, startMoonPhase).catch((err) => {
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
  const { createMoonScene } = await import('./scenes/moonScene.js');
  const moon = await createMoonScene({
    onComplete: () => startTravelPhase({
      fromLabel: 'the Moon',
      toLabel: "the Client's Homeworld",
      fromColor: '#9aa3ad',
      fromAccent: '#5c6068',
      toColor: '#8a6a4a',
      toAccent: '#4a3626',
      shotStyle: 'flyby',
      musicTheme: 'client',
    }, startClientWorldPhase).catch((err) => {
      console.error('Failed to start client-world phase:', err);
      showOverlay(
        'Something went wrong',
        `The next scene failed to load:\n${err.message}\n\nCheck the browser console for details.`,
        'Retry',
        () => startClientWorldPhase().catch((e) => console.error(e)),
      );
    }),
  });
  activeScene = moon;
  hideLoadingScreen();
}

async function startClientWorldPhase() {
  camera.position.set(0, 30, 8);
  teardownActiveScene();
  const returnTravelConfig = {
    fromLabel: "the Client's Homeworld",
    toLabel: 'a New Assignment',
    fromColor: '#8a6a4a',
    fromAccent: '#4a3626',
    toColor: '#7bc8ff',
    toAccent: '#3a6a99',
    shotStyle: 'pullback',
    musicTheme: 'ground',
  };
  const handleReturnTrip = () => startTravelPhase(returnTravelConfig, startGroundPhase).catch((err) => {
    console.error('Failed to start ground phase:', err);
    showOverlay(
      'Something went wrong',
      `The next scene failed to load:\n${err.message}\n\nCheck the browser console for details.`,
      'Retry',
      () => startGroundPhase().catch((e) => console.error(e)),
    );
  });
  const { createClientWorldScene } = await import('./scenes/clientWorldScene.js');
  const clientWorld = await createClientWorldScene({
    onDeliver: handleReturnTrip,
    onRefuseEscape: handleReturnTrip,
  });
  activeScene = clientWorld;
  hideLoadingScreen();
}

async function startGroundPhase() {
  camera.position.set(0, 25, 6.5);
  teardownActiveScene();
  const { createGroundScene } = await import('./scenes/groundScene.js');
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

// Escape (or the gear button) opens Settings from anywhere and freezes
// gameplay updates while it's up — see the paused check in animate() below.
let paused = false;
initSettingsMenu({
  onOpen: () => { paused = true; },
  onClose: () => { paused = false; },
});

// The title screen's Start click is the game's first real user gesture —
// asset loading (and the loading screen) only begins once it fires, rather
// than starting immediately on page load before the player has done
// anything.
showTitleScreen({
  onStart: () => {
    showLoadingScreen();
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
  },
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
    if (!paused) scene.update(dt, elapsed, camera);
    renderer.render(scene.scene, camera);
  }
}

animate();
