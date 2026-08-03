import { consumeJumpPress } from './input.js';

// "Signal Drift" — a straight Flappy Bird clone (sky, scrolling ground,
// green pipes, a bird that flaps), not just a same-mechanic reskin — the
// other two computer puzzles lean into an alien-terminal aesthetic, but this
// one is meant to actually read as Flappy Bird at a glance. Space (or a
// click/tap on the field) flaps; PASSES_NEEDED clean pipe-passes solves it.
// Clipping a pipe, the ceiling, or the ground resets the whole round —
// pipes cleared, passes back to 0 — same as real Flappy Bird, and it's
// still "no fail state" at the puzzle level the way every other puzzle in
// the game is (signalMazePuzzle's out-of-lives round reset is the same
// idea): there's no lock-out, just try again from a clean board.
const GAME_WIDTH = 300;
const GAME_HEIGHT = 380;
const GROUND_HEIGHT = 36;
// The strip of sky the bird can actually occupy — GROUND_HEIGHT is purely
// decorative scenery below this, so the floor collision is the top of the
// ground strip, not the bottom of the field.
const SKY_HEIGHT = GAME_HEIGHT - GROUND_HEIGHT;

const BIRD_SIZE = 24;
const BIRD_X = 60;
const GRAVITY = 1000; // px/s^2
const FLAP_VY = -300; // px/s, instantaneous velocity set on flap
const MAX_FALL_VY = 380;

const PIPE_WIDTH = 46;
const PIPE_GAP = 120;
const PIPE_SPEED = 130; // px/s, leftward
const PIPE_SPAWN_INTERVAL_MS = 1550;
const PIPE_GAP_MARGIN = 34; // keeps the gap's center off the very top/bottom edge

const PASSES_NEEDED = 10;
const INVULN_MS = 900;

let overlayEl = null;
let fieldEl = null;
let statusEl = null;
let countEl = null;
let birdEl = null;

let onSolvedCallback = null;
let onCancelCallback = null;
let running = false;
let rafId = null;
let lastFrameTime = 0;
let spawnTimer = 0;
let flapAnimTimeout = null;

let bird = { y: 0, vy: 0 };
let invulnMs = 0;
let pipes = []; // { x, gapY, passed, topEl, bottomEl }
let passes = 0;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function clearPipes() {
  for (const p of pipes) {
    p.topEl.remove();
    p.bottomEl.remove();
  }
  pipes = [];
}

function spawnPipe() {
  const gapY = PIPE_GAP_MARGIN + Math.random() * (SKY_HEIGHT - PIPE_GAP - PIPE_GAP_MARGIN * 2);
  const topEl = document.createElement('div');
  topEl.className = 'flappybird-pipe flappybird-pipe-top';
  const bottomEl = document.createElement('div');
  bottomEl.className = 'flappybird-pipe flappybird-pipe-bottom';
  fieldEl.appendChild(topEl);
  fieldEl.appendChild(bottomEl);
  pipes.push({
    x: GAME_WIDTH, gapY, passed: false, topEl, bottomEl,
  });
}

function respawnBird() {
  bird.y = SKY_HEIGHT / 2 - BIRD_SIZE / 2;
  bird.vy = 0;
  invulnMs = INVULN_MS;
}

function flap() {
  if (!running) return;
  bird.vy = FLAP_VY;
  // A quick squash/stretch pulse on the wing beat — pure cosmetic feedback,
  // reset by re-triggering the CSS animation from scratch on every flap
  // (remove-then-reflow-then-add) rather than letting it just restart, since
  // rapid flapping would otherwise leave the class already present and the
  // animation wouldn't restart at all.
  birdEl.classList.remove('flappybird-flapping');
  void birdEl.offsetWidth;
  birdEl.classList.add('flappybird-flapping');
  clearTimeout(flapAnimTimeout);
  flapAnimTimeout = setTimeout(() => birdEl.classList.remove('flappybird-flapping'), 220);
}

function finishPuzzle() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  setStatus('Approach pattern locked in.');
  const callback = onSolvedCallback;
  setTimeout(() => {
    hideFlappyBirdPuzzle();
    if (callback) callback();
  }, 400);
}

// A full round reset, same as real Flappy Bird — every pipe on screen is
// removed (not just the one that got clipped), so the loop in
// updatePhysics below MUST stop touching `pipes` the instant this runs
// rather than continuing to index into the array it just replaced.
function crash() {
  clearPipes();
  passes = 0;
  spawnTimer = 0;
  if (countEl) countEl.textContent = `0/${PASSES_NEEDED}`;
  respawnBird();
  setStatus(`Crashed — starting over. (0/${PASSES_NEEDED})`);
}

function updatePhysics(dt) {
  bird.vy = Math.min(MAX_FALL_VY, bird.vy + GRAVITY * dt);
  bird.y += bird.vy * dt;

  if (invulnMs > 0) invulnMs -= dt * 1000;

  if (bird.y <= 0) {
    bird.y = 0;
    if (invulnMs <= 0) { crash(); return; }
  } else if (bird.y + BIRD_SIZE >= SKY_HEIGHT) {
    bird.y = SKY_HEIGHT - BIRD_SIZE;
    if (invulnMs <= 0) { crash(); return; }
  }

  spawnTimer += dt * 1000;
  if (spawnTimer >= PIPE_SPAWN_INTERVAL_MS) {
    spawnTimer -= PIPE_SPAWN_INTERVAL_MS;
    spawnPipe();
  }

  for (let i = pipes.length - 1; i >= 0; i--) {
    const p = pipes[i];
    p.x -= PIPE_SPEED * dt;

    const xOverlaps = p.x < BIRD_X + BIRD_SIZE && p.x + PIPE_WIDTH > BIRD_X;
    if (xOverlaps && invulnMs <= 0) {
      const inGap = bird.y >= p.gapY && bird.y + BIRD_SIZE <= p.gapY + PIPE_GAP;
      if (!inGap) {
        crash();
        return;
      }
    }

    if (!p.passed && p.x + PIPE_WIDTH < BIRD_X) {
      p.passed = true;
      passes += 1;
      if (countEl) countEl.textContent = `${passes}/${PASSES_NEEDED}`;
      if (passes >= PASSES_NEEDED) {
        finishPuzzle();
        return;
      }
      setStatus('Clean pass!');
    }

    if (p.x + PIPE_WIDTH < 0) {
      p.topEl.remove();
      p.bottomEl.remove();
      pipes.splice(i, 1);
    }
  }
}

function render() {
  birdEl.style.top = `${bird.y}px`;
  // Classic Flappy Bird tilt: a sharp nose-up snap on a flap, easing over
  // into a steep nose-down dive as fall speed climbs toward terminal
  // velocity, rather than a small/subtle rotation range.
  const angle = Math.max(-25, Math.min(90, (bird.vy / MAX_FALL_VY) * 90));
  birdEl.style.transform = `rotate(${angle}deg)`;
  birdEl.style.opacity = invulnMs > 0 && Math.floor(invulnMs / 90) % 2 === 0 ? '0.35' : '1';

  for (const p of pipes) {
    p.topEl.style.left = `${p.x}px`;
    p.topEl.style.width = `${PIPE_WIDTH}px`;
    p.topEl.style.top = '0px';
    p.topEl.style.height = `${p.gapY}px`;

    p.bottomEl.style.left = `${p.x}px`;
    p.bottomEl.style.width = `${PIPE_WIDTH}px`;
    p.bottomEl.style.top = `${p.gapY + PIPE_GAP}px`;
    p.bottomEl.style.height = `${SKY_HEIGHT - (p.gapY + PIPE_GAP)}px`;
  }
}

function gameLoop(now) {
  if (!running) return;
  if (!lastFrameTime) lastFrameTime = now;
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  if (consumeJumpPress()) flap();
  updatePhysics(dt);
  if (running) render();

  rafId = requestAnimationFrame(gameLoop);
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'flappybird-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="flappybird-box">
      <h1>Signal Drift</h1>
      <p id="flappybird-status">Space, or click/tap the field, to flap. Get 10 clean passes.</p>
      <div id="flappybird-field">
        <div class="flappybird-cloud flappybird-cloud-a"></div>
        <div class="flappybird-cloud flappybird-cloud-b"></div>
        <div class="flappybird-cloud flappybird-cloud-c"></div>
        <div id="flappybird-ground"></div>
      </div>
      <div id="flappybird-count">0/${PASSES_NEEDED}</div>
      <button id="flappybird-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);
  statusEl = overlayEl.querySelector('#flappybird-status');
  countEl = overlayEl.querySelector('#flappybird-count');
  fieldEl = overlayEl.querySelector('#flappybird-field');
  fieldEl.style.width = `${GAME_WIDTH}px`;
  fieldEl.style.height = `${GAME_HEIGHT}px`;
  overlayEl.querySelector('#flappybird-ground').style.height = `${GROUND_HEIGHT}px`;

  birdEl = document.createElement('div');
  birdEl.id = 'flappybird-bird';
  birdEl.style.width = `${BIRD_SIZE}px`;
  birdEl.style.height = `${BIRD_SIZE}px`;
  birdEl.style.left = `${BIRD_X}px`;
  const beakEl = document.createElement('div');
  beakEl.className = 'flappybird-beak';
  birdEl.appendChild(beakEl);
  fieldEl.appendChild(birdEl);

  fieldEl.addEventListener('pointerdown', flap);

  overlayEl.querySelector('#flappybird-close').addEventListener('click', () => {
    hideFlappyBirdPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

export function showFlappyBirdPuzzle(onSolved, onCancel) {
  ensureDom();
  if (rafId) cancelAnimationFrame(rafId);
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;

  clearPipes();
  passes = 0;
  spawnTimer = 0;
  countEl.textContent = `0/${PASSES_NEEDED}`;
  setStatus('Space, or click/tap the field, to flap. Get 10 clean passes.');
  respawnBird();
  render();

  overlayEl.classList.remove('hidden');
  running = true;
  lastFrameTime = 0;
  rafId = requestAnimationFrame(gameLoop);
}

export function hideFlappyBirdPuzzle() {
  running = false;
  clearTimeout(flapAnimTimeout);
  if (rafId) cancelAnimationFrame(rafId);
  if (overlayEl) overlayEl.classList.add('hidden');
}
