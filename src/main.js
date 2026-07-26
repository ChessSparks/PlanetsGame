import * as THREE from 'three';
import { initInput } from './game/input.js';
import { showOverlay, showHud, hideKeysDisplay } from './game/hud.js';
import { createGroundScene } from './scenes/groundScene.js';
import { createAscentScene } from './scenes/ascentScene.js';

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

function startAscentPhase(fuelCellsCollected, totalFuelCells) {
  const startFuel = Math.min(100, 60 + Math.round((fuelCellsCollected / totalFuelCells) * 40));
  hideKeysDisplay();
  showHud();
  camera.position.set(0, -1.7, 15);
  activeScene = createAscentScene({
    startFuel,
    onRestart: () => startGroundPhase(),
  });
  showOverlay(
    'Liftoff!',
    `Rocket repaired and fueled (${fuelCellsCollected}/${totalFuelCells} fuel cells collected on the ground).\nStarting fuel: ${startFuel}%\n\nW/↑: Thrust    A/D or ←/→: Strafe`,
    'Launch',
    () => {},
  );
}

async function startGroundPhase() {
  camera.position.set(0, 25, 6.5);
  activeScene = null;
  const ground = await createGroundScene({
    onLaunch: (collected, total) => startAscentPhase(collected, total),
  });
  activeScene = ground;
}

startGroundPhase().catch((err) => {
  console.error('Failed to start ground phase:', err);
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

  if (activeScene) {
    activeScene.update(dt, elapsed, camera);
    renderer.render(activeScene.scene, camera);
  }
}

animate();
