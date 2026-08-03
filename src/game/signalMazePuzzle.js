// "Signal Maze" — a proper small Pac-Man: a bigger maze with a real side
// tunnel, two ghosts that actively chase (and avoid stacking on top of each
// other), power pellets that let you turn the tables and eat them for a
// few seconds, continuous glide movement (the player's pixel position is
// driven directly every animation frame, not snapped cell-to-cell via a
// CSS transition — see updatePlayerMotion/renderPlayer — so it stays
// smooth regardless of any drift between the JS tick clock and the
// browser's own transition timing), input buffering so turns at
// intersections feel responsive instead of needing a perfectly-timed
// keypress, and 3 lives. Reuses the
// same WASD/arrow `keys` state the player walks with elsewhere — safe
// since the main scene's own movement is gated off while any puzzle
// overlay is open. Getting caught by a non-frightened ghost costs a life
// and bounces you back to the start (fragments/pellets already collected
// stay collected); running out of lives resets the whole round (fresh
// board, lives back to 3) rather than failing the puzzle outright — same
// "no fail state" spirit as every other puzzle in the game, just Pac-Man's
// own flavor of it. Distinct mechanic from all of them: real-time grid
// navigation + chase/evade, not memory, deduction, reordering, connecting,
// or a static timing bar.
import { keys } from './input.js';

const MAZE = [
  '###############',
  '#....#...#....#',
  '#.##.#.#.#.##.#',
  '#.#.........#.#',
  '#.#.##.#.##.#.#',
  '#...#.....#...#',
  '#.#.#.###.#.#.#',
  '.......#.......',
  '#.#.#.###.#.#.#',
  '#...#.....#...#',
  '#.#.##.#.##.#.#',
  '#.#.........#.#',
  '#.##.#.#.#.##.#',
  '#....#...#....#',
  '###############',
];
const ROWS = MAZE.length;
const COLS = MAZE[0].length;
const TUNNEL_ROW = 7; // the only row with open left/right ends — wraps around
const CELL_SIZE = 24; // px

const PLAYER_START = { row: 1, col: 1 };
const GHOST_STARTS = [
  { row: 13, col: 13, color: '#ff5a5a' },
  { row: 1, col: 13, color: '#7be0ff' },
];
const POWER_PELLETS = [
  { row: 3, col: 1 }, { row: 3, col: 13 }, { row: 11, col: 1 }, { row: 11, col: 13 },
];

const MOVE_INTERVAL_MS = 120; // how long crossing one cell takes — now just the basis for PLAYER_SPEED
const GHOST_INTERVAL_MS = 380;
const FRIGHTENED_DURATION_MS = 6000;
const LIVES_START = 3;
const DIR_ANGLES = {
  right: 0, down: 90, left: 180, up: 270,
};
const DIR_DELTAS = {
  up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 }, left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 },
};
// px/sec — same pace as the old one-cell-per-tick timing, just applied
// continuously (see updatePlayerMotion) instead of in discrete 120ms hops.
const PLAYER_SPEED = CELL_SIZE / (MOVE_INTERVAL_MS / 1000);

let overlayEl = null;
let gridEl = null;
let statusEl = null;
let countEl = null;
let livesEl = null;
let playerEl = null;
let ghostEls = [];
let cellEls = [];

let dots = [];
let isPellet = [];
let dotsRemaining = 0;

let playerPos = { ...PLAYER_START };
// currentDir is what's actually executing right now; once set, movement
// continues on its own every tick regardless of whether a key is still
// held — a key press only ever updates desiredDir (see readDesiredDir/
// tryMovePlayer below), it's never required continuously. desiredDir
// persists at its last value forever, so pacman just keeps going in
// whatever direction was last chosen until a wall stops it or a new,
// currently-open direction is requested.
let currentDir = null;
let desiredDir = null;
// Progress (0..1) from playerPos toward stepTowards(playerPos, currentDir) —
// the player's actual rendered position every frame, see renderPlayer().
let moveT = 0;
// Tracks the player's rotation as a continuously-accumulating value (not
// wrapped to 0-359) rather than always jumping straight to DIR_ANGLES[dir]
// — see turnTo() below for why.
let facingAngle = 0;

let ghosts = []; // { row, col }
let frightenedUntil = 0;
let lives = LIVES_START;

let onSolvedCallback = null;
let onCancelCallback = null;
let running = false;
let rafId = null;
let lastFrameTime = 0;
let ghostAccumulatorMs = 0;

function idx(row, col) {
  return row * COLS + col;
}

function isWallRaw(row, col) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
  return MAZE[row][col] === '#';
}

function stepTowards(pos, dir) {
  const d = DIR_DELTAS[dir];
  if (!d) return { ...pos };
  let row = pos.row + d.dr;
  let col = pos.col + d.dc;
  if (row === TUNNEL_ROW) {
    if (col < 0) col = COLS - 1;
    if (col >= COLS) col = 0;
  }
  return { row, col };
}

function readDesiredDir() {
  if (keys.up) return 'up';
  if (keys.down) return 'down';
  if (keys.left) return 'left';
  if (keys.right) return 'right';
  return null;
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

// `instant` skips the CSS glide — used for the tunnel wraparound, where the
// column jumps clear across the maze (col 0 <-> col COLS-1) in one logical
// step. Without this, that jump animates via the normal left/top transition
// like every other move, which reads as pacman sliding across every wall
// and cell in between instead of instantly appearing on the other side.
function positionEntity(el, row, col, instant = false) {
  if (instant) {
    const prevTransition = el.style.transition;
    el.style.transition = 'none';
    el.style.left = `${col * CELL_SIZE + 2}px`;
    el.style.top = `${row * CELL_SIZE + 2}px`;
    // Forces the browser to apply transition:none before it's restored —
    // without reading a layout property here, the two style writes could
    // get batched and the transition would still animate the jump.
    void el.offsetWidth;
    el.style.transition = prevTransition;
    return;
  }
  el.style.left = `${col * CELL_SIZE + 2}px`;
  el.style.top = `${row * CELL_SIZE + 2}px`;
}

// A normal step only ever changes col by 1 (or row by 1, col by 0) — only
// the tunnel wraparound jumps straight from one edge to the other, so any
// larger jump can only be that.
function wrappedColumn(prevCol, nextCol) {
  return Math.abs(nextCol - prevCol) > 1;
}

function isFrightened() {
  return performance.now() < frightenedUntil;
}

function collectAt(row, col) {
  const i = idx(row, col);
  if (!dots[i]) return;
  const wasPellet = isPellet[i];
  dots[i] = false;
  dotsRemaining -= 1;
  cellEls[i].classList.remove('signalmaze-dot', 'signalmaze-pellet');
  if (countEl) countEl.textContent = `${dotsRemaining}`;
  if (wasPellet) {
    frightenedUntil = performance.now() + FRIGHTENED_DURATION_MS;
    setStatus('Ghosts frightened — chase them down!');
  }
}

function updateLivesDisplay() {
  if (livesEl) livesEl.textContent = '♥'.repeat(Math.max(0, lives));
}

function resetGhostPositions() {
  ghosts.forEach((ghost, i) => {
    const start = GHOST_STARTS[i];
    ghost.row = start.row;
    ghost.col = start.col;
    positionEntity(ghostEls[i], ghost.row, ghost.col, true);
    ghostEls[i].classList.remove('signalmaze-frightened');
  });
}

function resetDotsAndPellets() {
  dots = [];
  isPellet = [];
  dotsRemaining = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = idx(row, col);
      const isStart = row === PLAYER_START.row && col === PLAYER_START.col;
      const collectible = !isWallRaw(row, col) && !isStart;
      dots[i] = collectible;
      isPellet[i] = collectible && POWER_PELLETS.some((p) => p.row === row && p.col === col);
      if (collectible) dotsRemaining += 1;
      cellEls[i].classList.toggle('signalmaze-dot', dots[i] && !isPellet[i]);
      cellEls[i].classList.toggle('signalmaze-pellet', dots[i] && isPellet[i]);
    }
  }
  if (countEl) countEl.textContent = `${dotsRemaining}`;
}

// Out of lives: rather than failing the puzzle outright (every other puzzle
// in the game has no fail state), a full Pac-Man-style game over just resets
// this attempt back to a fresh board — dots, pellets, lives, everyone's
// position — so the player tries again instead of getting locked out.
function resetRound() {
  lives = LIVES_START;
  updateLivesDisplay();
  frightenedUntil = 0;
  playerPos = { ...PLAYER_START };
  currentDir = null;
  desiredDir = null;
  moveT = 0;
  facingAngle = 0;
  playerEl.style.transform = 'rotate(0deg)';
  renderPlayer();
  resetGhostPositions();
  resetDotsAndPellets();
}

function caughtBy(ghostIndex) {
  if (isFrightened()) {
    const start = GHOST_STARTS[ghostIndex];
    ghosts[ghostIndex].row = start.row;
    ghosts[ghostIndex].col = start.col;
    positionEntity(ghostEls[ghostIndex], start.row, start.col, true);
    setStatus('Ghost eaten! Keep collecting.');
    return;
  }
  lives -= 1;
  updateLivesDisplay();
  if (lives <= 0) {
    setStatus('Out of lives — signal reset. Starting over.');
    resetRound();
    return;
  }
  setStatus(`Spotted! ${lives} ${lives === 1 ? 'life' : 'lives'} left — fragments already collected stay collected.`);
  playerPos = { ...PLAYER_START };
  currentDir = null;
  desiredDir = null;
  moveT = 0;
  renderPlayer();
  // Ghosts reset too, same as classic Pac-Man on a death — otherwise one
  // could simply be sitting on the player's spawn cell and drain every
  // remaining life in an instant with no chance to react.
  resetGhostPositions();
}

function checkGhostCollisions() {
  ghosts.forEach((ghost, i) => {
    if (ghost.row === playerPos.row && ghost.col === playerPos.col) caughtBy(i);
  });
}

function finishPuzzle() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  setStatus('All fragments collected.');
  const callback = onSolvedCallback;
  setTimeout(() => {
    hideSignalMazePuzzle();
    if (callback) callback();
  }, 400);
}

// Rotates by the shortest signed delta to DIR_ANGLES[dir] instead of jumping
// straight to that fixed 0/90/180/270 value — e.g. turning from 'right' (0)
// to 'up' (270) would otherwise spin the long way around (0 -> 270, a
// 270-degree turn) instead of the visually-obvious short hop (0 -> -90).
// facingAngle itself is left unwrapped (can go negative or past 360) so the
// delta math and the CSS transition it drives stay correct no matter how
// many turns have accumulated.
function turnTo(dir) {
  const target = DIR_ANGLES[dir];
  const delta = ((target - facingAngle + 180) % 360 + 360) % 360 - 180;
  facingAngle += delta;
  playerEl.style.transform = `rotate(${facingAngle}deg)`;
}

// Polled every animation frame (see gameLoop) purely to capture input —
// committing the turn itself happens in tryCommitTurn below, only at the
// instant the player is centered on a cell (moveT <= 0). Doing it here
// unconditionally would let currentDir change mid-glide, and since
// rendering now lerps from playerPos toward stepTowards(playerPos,
// currentDir), retargeting that lerp before playerPos itself has actually
// arrived snaps the sprite backwards onto the new target's line instead of
// smoothly continuing — the classic-Pac-Man rule of only turning at
// intersections isn't just flavor here, it's what keeps the interpolation
// consistent.
function updateDesiredDir() {
  if (!running) return;
  const pressed = readDesiredDir();
  if (pressed) desiredDir = pressed;
}

// Buffered turning: commits to desiredDir the moment it's open, checked
// every time the player is centered on a cell (moveT <= 0) rather than
// needing a frame-perfect keypress right at the intersection.
function tryCommitTurn() {
  if (!desiredDir || desiredDir === currentDir) return;
  const attempt = stepTowards(playerPos, desiredDir);
  if (!isWallRaw(attempt.row, attempt.col)) {
    currentDir = desiredDir;
    turnTo(currentDir);
  }
}

// Draws the player at its true interpolated pixel position — playerPos is
// the cell already arrived at, moveT is how far through the glide to
// stepTowards(playerPos, currentDir) it currently is. The tunnel wrap is a
// special case: that target's column is clear on the opposite side of the
// maze, so lerping toward it directly would slide pacman across every wall
// in between; instead the sprite holds at the edge cell for the glide's
// full duration and only snaps once playerPos itself updates (see
// updatePlayerMotion), same "instant, no visible slide" behavior the old
// CSS-transition version used positionEntity's instant flag for.
function renderPlayer() {
  let x = playerPos.col * CELL_SIZE;
  let y = playerPos.row * CELL_SIZE;
  if (currentDir && moveT > 0) {
    const target = stepTowards(playerPos, currentDir);
    if (!wrappedColumn(playerPos.col, target.col)) {
      const d = DIR_DELTAS[currentDir];
      x += d.dc * CELL_SIZE * moveT;
      y += d.dr * CELL_SIZE * moveT;
    }
  }
  playerEl.style.left = `${x + 2}px`;
  playerEl.style.top = `${y + 2}px`;
}

// Continuous per-frame movement — dt is in seconds. Replaces the old
// fixed-tick "hop one cell every MOVE_INTERVAL_MS" step: position is now
// integrated every frame at PLAYER_SPEED px/sec, so the glide is driven by
// the same clock that renders it instead of relying on a CSS transition to
// smooth over discrete JS-side hops (any drift between the two was the
// source of the occasional stutter/hitch this replaces).
function updatePlayerMotion(dt) {
  if (!running) return;
  if (moveT <= 0) tryCommitTurn();

  if (!currentDir) {
    renderPlayer();
    return;
  }

  let target = stepTowards(playerPos, currentDir);
  if (isWallRaw(target.row, target.col)) {
    currentDir = null;
    moveT = 0;
    renderPlayer();
    return;
  }

  moveT += (PLAYER_SPEED * dt) / CELL_SIZE;
  // A while loop (not a single if) so a large dt (e.g. right after the tab
  // regains focus) can correctly resolve crossing more than one cell in a
  // single frame instead of getting stuck rendering past moveT === 1.
  while (moveT >= 1 && currentDir) {
    moveT -= 1;
    playerPos = target;
    collectAt(playerPos.row, playerPos.col);
    checkGhostCollisions();
    if (dotsRemaining <= 0) { finishPuzzle(); return; }
    tryCommitTurn();
    target = currentDir ? stepTowards(playerPos, currentDir) : null;
    if (!target || isWallRaw(target.row, target.col)) {
      currentDir = null;
      moveT = 0;
    }
  }
  renderPlayer();
}

// Greedy step toward the player (or, while frightened, away from them) —
// not full pathfinding, plenty for a maze this size. Also refuses to step
// onto whatever cell another ghost currently occupies, so the two ghosts
// can never land on top of each other — without that check they'd happily
// both path onto the same cell and visually merge into one.
function stepGhost(ghost, ghostIndex) {
  const options = ['up', 'down', 'left', 'right']
    .map((dir) => stepTowards(ghost, dir))
    .filter((o) => !isWallRaw(o.row, o.col))
    .filter((o) => !ghosts.some((other, j) => j !== ghostIndex && other.row === o.row && other.col === o.col))
    .map((o) => ({ ...o, d: Math.abs(o.row - playerPos.row) + Math.abs(o.col - playerPos.col) }));
  if (options.length === 0) return; // boxed in, or every open cell is taken by the other ghost
  options.sort((a, b) => (isFrightened() ? b.d - a.d : a.d - b.d));
  ghost.row = options[0].row;
  ghost.col = options[0].col;
}

function tickGhosts() {
  if (!running) return;
  const frightened = isFrightened();
  ghosts.forEach((ghost, i) => {
    const prevCol = ghost.col;
    stepGhost(ghost, i);
    positionEntity(ghostEls[i], ghost.row, ghost.col, wrappedColumn(prevCol, ghost.col));
    ghostEls[i].classList.toggle('signalmaze-frightened', frightened);
  });
  checkGhostCollisions();
}

// requestAnimationFrame — the player now moves continuously every frame
// (see updatePlayerMotion), while ghosts still use a fixed-timestep
// accumulator so their own hop rate stays independent of display refresh
// rate and immune to background-tab throttling/drift.
function gameLoop(now) {
  if (!running) return;
  if (!lastFrameTime) lastFrameTime = now;
  const dtMs = Math.min(now - lastFrameTime, 250); // clamp huge gaps (tab was backgrounded)
  lastFrameTime = now;

  updateDesiredDir();
  updatePlayerMotion(dtMs / 1000);

  ghostAccumulatorMs += dtMs;
  while (ghostAccumulatorMs >= GHOST_INTERVAL_MS) {
    ghostAccumulatorMs -= GHOST_INTERVAL_MS;
    tickGhosts();
  }

  rafId = requestAnimationFrame(gameLoop);
}

function buildGridDom() {
  gridEl.innerHTML = '';
  gridEl.style.width = `${COLS * CELL_SIZE}px`;
  gridEl.style.height = `${ROWS * CELL_SIZE}px`;
  cellEls = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = document.createElement('div');
      cell.className = isWallRaw(row, col) ? 'signalmaze-wall' : 'signalmaze-floor';
      cell.style.width = `${CELL_SIZE}px`;
      cell.style.height = `${CELL_SIZE}px`;
      cell.style.left = `${col * CELL_SIZE}px`;
      cell.style.top = `${row * CELL_SIZE}px`;
      gridEl.appendChild(cell);
      cellEls.push(cell);
    }
  }

  const entitySize = CELL_SIZE - 4;
  playerEl = document.createElement('div');
  playerEl.className = 'signalmaze-entity signalmaze-pacman';
  playerEl.style.width = `${entitySize}px`;
  playerEl.style.height = `${entitySize}px`;
  // Overrides the shared .signalmaze-entity rule's left/top transition —
  // the player's position is now set every animation frame directly (see
  // renderPlayer), so a CSS transition on top of that would just add extra
  // lag chasing an already-interpolated value. Ghosts (still tick+CSS
  // driven) keep the full shared rule. Rotation still eases via transform.
  playerEl.style.transition = 'transform 0.12s linear';
  gridEl.appendChild(playerEl);

  ghostEls = GHOST_STARTS.map((start) => {
    const el = document.createElement('div');
    el.className = 'signalmaze-entity signalmaze-ghost-el';
    el.style.width = `${entitySize}px`;
    el.style.height = `${entitySize}px`;
    el.style.setProperty('--ghost-color', start.color);
    gridEl.appendChild(el);
    return el;
  });
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'signalmaze-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="signalmaze-box">
      <h1>Signal Maze</h1>
      <p id="signalmaze-status">WASD/arrows to move. Collect every fragment. Grab the cherry to eat the ghosts for a few seconds.</p>
      <div id="signalmaze-grid"></div>
      <div id="signalmaze-hud">
        <div id="signalmaze-lives"></div>
        <div id="signalmaze-count"></div>
      </div>
      <button id="signalmaze-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);
  statusEl = overlayEl.querySelector('#signalmaze-status');
  countEl = overlayEl.querySelector('#signalmaze-count');
  livesEl = overlayEl.querySelector('#signalmaze-lives');
  gridEl = overlayEl.querySelector('#signalmaze-grid');
  buildGridDom();

  overlayEl.querySelector('#signalmaze-close').addEventListener('click', () => {
    hideSignalMazePuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

export function showSignalMazePuzzle(onSolved, onCancel) {
  ensureDom();
  if (rafId) cancelAnimationFrame(rafId);
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;

  playerPos = { ...PLAYER_START };
  currentDir = null;
  desiredDir = null;
  moveT = 0;
  facingAngle = 0;
  frightenedUntil = 0;
  lives = LIVES_START;
  updateLivesDisplay();
  ghosts = GHOST_STARTS.map((g) => ({ row: g.row, col: g.col }));

  resetDotsAndPellets();

  playerEl.style.transform = 'rotate(0deg)';
  renderPlayer();
  ghosts.forEach((ghost, i) => {
    positionEntity(ghostEls[i], ghost.row, ghost.col, true);
    ghostEls[i].classList.remove('signalmaze-frightened');
  });
  setStatus('WASD/arrows to move. Collect every fragment. Grab the cherry to eat the ghosts for a few seconds.');

  overlayEl.classList.remove('hidden');
  running = true;
  lastFrameTime = 0;
  ghostAccumulatorMs = 0;
  rafId = requestAnimationFrame(gameLoop);
}

export function hideSignalMazePuzzle() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (overlayEl) overlayEl.classList.add('hidden');
}
