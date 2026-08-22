import * as THREE from 'three';
import { initInput } from './game/input.js';
import { initTouchControls } from './game/touchControls.js';
import {
  showOverlay, showHud, hideHud, hideKeysDisplay, setLoadingProgress, hideLoadingScreen, showLoadingScreen,
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

// Every inter-level travel cutscene, each pulled out into its own named
// function (rather than left inline in the phase-starter that normally
// triggers it) for two reasons: the dev switcher below can preview any of
// them directly without playing up to that point first, and there's a
// single definition of each transition's config instead of one copy buried
// in a closure that could drift from what the dev button plays.
function startHomeOrbitToMoonTravel() {
  return startTravelPhase({
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
  });
}

function startMoonToClientWorldTravel() {
  return startTravelPhase({
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
  });
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
    onOrbitReached: () => startHomeOrbitToMoonTravel(),
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
    onComplete: () => startMoonToClientWorldTravel(),
  });
  activeScene = moon;
  hideLoadingScreen();
}

// A teaser card shown right before the Mission Complete/Restart screen —
// hints at future missions/planets rather than just cutting straight to
// "the end," so the story reads as paused rather than fully closed off.
// Shown after Mission VI (Smite Colony) now, so it only teases what's still
// unbuilt (VII-VIII) rather than V or VI, which the player just played.
function showToBeContinuedScreen() {
  teardownActiveScene();
  hideHud();
  hideKeysDisplay();
  showOverlay(
    'To Be Continued...',
    'The buyer\'s list is aboard, encrypted six ways from Sunday — and Kaross Vey isn\'t a mystery anymore '
    + 'either.\n\n'
    + 'Corthana\'s already parsing headers when the next contract lights up the console.\n\n'
    + 'Coming missions:\n\n'
    + '— Mission VII: The Next Quiet Planet\n'
    + '— Mission VIII: Reclamation\n\n'
    + 'The ship\'s fueled. The stars aren\'t going anywhere. Neither, it turns out, are you.',
    'Continue',
    () => showEndingScreen(),
  );
}

// Final overlay after the story's last choice plays out — offers a clean
// restart instead of the game silently looping back into a new run the way
// every earlier level transition does. Restart re-enters at the ground
// phase directly (same entry point the title screen's Start button uses).
function showEndingScreen() {
  teardownActiveScene();
  hideHud();
  hideKeysDisplay();
  showOverlay(
    'Mission Complete',
    'That\'s the end of the road for this run.\n\nYou can play through again whenever you\'re ready.',
    'Restart',
    () => {
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
  );
}

function startClientWorldToExchangeTravel() {
  return startTravelPhase({
    fromLabel: "the Client's Homeworld",
    toLabel: 'the Exchange',
    fromColor: '#8a6a4a',
    fromAccent: '#4a3626',
    toColor: '#c47a56',
    toAccent: '#7a4a30',
    shotStyle: 'pullback',
    musicTheme: 'moon',
  }, () => startBuyersListPhase()).catch((err) => {
    console.error('Failed to play the closing cutscene:', err);
    startBuyersListPhase().catch((e) => console.error(e));
  });
}

async function startClientWorldPhase() {
  camera.position.set(0, 30, 8);
  teardownActiveScene();
  const { createClientWorldScene } = await import('./scenes/clientWorldScene.js');
  const clientWorld = await createClientWorldScene({
    onEscape: () => startClientWorldToExchangeTravel(),
  });
  activeScene = clientWorld;
  hideLoadingScreen();
}

// Mission V: the alien trade world where the buyer's list gets pulled from
// 3 archive terminals. onComplete plays the closing cutscene into Mission
// VI (Smite Colony) — the list names Kaross Vey there, so that's the very
// next stop, not straight to the To-Be-Continued/Mission-Complete flow.
// Shared by startBuyersListPhase's real onComplete and the dev switcher's
// standalone cutscene-preview button below.
function startExchangeToSmiteColonyTravel() {
  return startTravelPhase({
    fromLabel: 'the Exchange',
    toLabel: 'Smite Colony',
    fromColor: '#c47a56',
    fromAccent: '#7a4a30',
    toBodyAssetPath: '/assets/sixth/whimsical_cartoon_space_land_3d_model.glb',
    toBodyHeight: 30,
    shotStyle: 'pullback',
    musicTheme: 'client',
  }, async () => startSmiteColonyPhase()).catch((err) => {
    console.error('Failed to start Smite Colony phase:', err);
    startSmiteColonyPhase().catch((e) => console.error(e));
  });
}

async function startBuyersListPhase() {
  camera.position.set(0, 25, 6.5);
  teardownActiveScene();
  const { createBuyersListScene } = await import('./scenes/buyersListScene.js');
  const buyersList = await createBuyersListScene({
    onComplete: () => startExchangeToSmiteColonyTravel(),
  });
  activeScene = buyersList;
  hideLoadingScreen();
}

function startSmiteColonyToHomeTravel() {
  return startTravelPhase({
    fromLabel: 'Smite Colony',
    toLabel: 'Home',
    fromColor: '#8c8c94',
    fromAccent: '#46464e',
    toColor: '#7bc8ff',
    toAccent: '#3a6a99',
    shotStyle: 'pullback',
    musicTheme: 'ground',
  }, async () => showToBeContinuedScreen()).catch((err) => {
    console.error('Failed to play the closing cutscene:', err);
    showToBeContinuedScreen();
  });
}

// Mission VI: Smite Colony, chasing down Kaross Vey — built around public/
// assets/sixth/'s remaining asset (a small drifting landmass) as the actual
// walkable ground. onComplete plays the closing cutscene into the
// To-Be-Continued/Mission-Complete flow every mission ends on — that flow
// moved here from Buyer's List now that this is the actual last built stop.
async function startSmiteColonyPhase() {
  camera.position.set(0, 25, 6.5);
  teardownActiveScene();
  const { createSmiteColonyScene } = await import('./scenes/smiteColonyScene.js');
  const smiteColony = await createSmiteColonyScene({
    onComplete: () => startSmiteColonyToHomeTravel(),
  });
  activeScene = smiteColony;
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
