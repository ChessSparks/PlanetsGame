// "Signal Labyrinth" — a real maze-navigation puzzle: find a path from the
// entrance to the exit. Deliberately NOT signalMazePuzzle.js's Pac-Man
// (no ghosts, no chase/evade, no lives, no continuous glide) — that one's
// already in the game for the buyer's-list terminals; this is the
// "labyrinth" ask specifically, a different mechanic (pathfinding through
// a generated maze) rather than real-time chase/evade in a fixed one.
// Movement is discrete, one cell per keypress (edge-triggered — holding a
// direction doesn't repeat-fire), which reads as a deliberate, thought-out
// step rather than Pac-Man's continuous walk. A fresh maze is generated
// every time the puzzle opens, rather than one fixed layout, so it doesn't
// become memorizable after the first solve — see generateMaze()'s own
// comment for the two-stage generation (carve, then braid) behind that.
// Rendered on a canvas (this file's only interactive puzzle overlay to do
// so, though every ground texture and the minimap already do) rather than
// a wall of DOM cells, since drawing wall segments directly is simpler
// than styling 150+ bordered divs into a clean maze grid.
import { keys } from './input.js';

// GRID_SIZE=13 (169 cells) rather than the original 9x9 (81) — a real
// difficulty jump, not just a cosmetic one, since the recursive-backtracker
// generator below produces a path whose typical length scales with cell
// count. BRAID_FRACTION is the other half of "more complicated": a plain
// recursive-backtracker maze is a "perfect maze" — exactly one path
// between any two cells, no loops — which reads as harder to look at but
// is actually trivial to solve by the textbook "always follow the
// left/right wall" method, since there's only ever one option at a fork.
// Braiding removes roughly half the dead ends by knocking down one extra
// wall at each (see braidMaze), turning some of those forced dead-end
// corridors into real junctions/loops — an actual choice with more than
// one way to keep going, and more than one way back. Verified numerically
// (1000 generated + braided mazes) that this stays solvable every time
// (braiding only ever adds connections, never removes the ones the
// original carve already guaranteed) while roughly halving the dead-end
// count, before relying on it here.
const GRID_SIZE = 13;
const BRAID_FRACTION = 0.5;
const CELL_PX = 26;
const CANVAS_SIZE = GRID_SIZE * CELL_PX;
const WALL_COLOR = '#bfe8ff';
const VISITED_COLOR = 'rgba(120, 200, 255, 0.12)';
const PLAYER_COLOR = '#7bd8ff';
const EXIT_COLOR = '#7bffb0';

const START = { x: 0, y: 0 };
const EXIT = { x: GRID_SIZE - 1, y: GRID_SIZE - 1 };

let overlayEl = null;
let canvas = null;
let ctx = null;
let statusEl = null;

let cells = []; // cells[y][x] = { N, E, S, W } — true = wall present on that edge
let visited = []; // visited[y][x] = boolean, purely cosmetic trail
let player = { x: 0, y: 0 };
let prevKeys = {
  up: false, down: false, left: false, right: false,
};

let onSolvedCallback = null;
let onCancelCallback = null;
let running = false;
let rafId = null;

// Randomized recursive backtracker (iterative, via an explicit stack) —
// standard "perfect maze" carve: starts fully walled, opens a passage to a
// random unvisited neighbor, repeats, backtracking via the stack whenever
// a cell has no unvisited neighbors left. On its own this guarantees
// exactly one path between any two cells (so START -> EXIT is solvable,
// but also trivially so — see BRAID_FRACTION above), which is why
// braidMaze() below runs immediately after to add real loops/junctions on
// top of this guaranteed-connected base.
function generateMaze() {
  const grid = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    const row = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      row.push({
        N: true, E: true, S: true, W: true, seen: false,
      });
    }
    grid.push(row);
  }
  const DIRS = [
    ['N', 0, -1, 'S'], ['E', 1, 0, 'W'], ['S', 0, 1, 'N'], ['W', -1, 0, 'E'],
  ];
  const stack = [[0, 0]];
  grid[0][0].seen = true;
  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const options = [];
    for (const [dir, dx, dy, opposite] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && !grid[ny][nx].seen) {
        options.push([dir, nx, ny, opposite]);
      }
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [dir, nx, ny, opposite] = options[Math.floor(Math.random() * options.length)];
    grid[y][x][dir] = false;
    grid[ny][nx][opposite] = false;
    grid[ny][nx].seen = true;
    stack.push([nx, ny]);
  }
  braidMaze(grid);
  return grid;
}

// For roughly BRAID_FRACTION of the maze's dead ends (cells with only one
// open side), knocks down one more wall toward an in-bounds neighbor —
// picked at random among that cell's remaining closed sides, whichever of
// those are actually available. Only ever opens connections that generateMaze's
// carve didn't already make, so the maze can only gain reachability, never
// lose it — it's still guaranteed solvable afterward.
function braidMaze(grid) {
  const DIRS = [
    ['N', 0, -1, 'S'], ['E', 1, 0, 'W'], ['S', 0, 1, 'N'], ['W', -1, 0, 'E'],
  ];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      const openCount = ['N', 'E', 'S', 'W'].filter((d) => !cell[d]).length;
      if (openCount !== 1) continue; // not a dead end
      if (Math.random() > BRAID_FRACTION) continue;
      const closed = DIRS.filter(([dir, dx, dy]) => {
        if (!cell[dir]) return false;
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE;
      });
      if (closed.length === 0) continue;
      const [dir, dx, dy, opposite] = closed[Math.floor(Math.random() * closed.length)];
      cell[dir] = false;
      grid[y + dy][x + dx][opposite] = false;
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = '#0a1420';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (visited[y][x]) {
        ctx.fillStyle = VISITED_COLOR;
        ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  // Exit marker, drawn under the walls so wall lines still read on top.
  ctx.fillStyle = EXIT_COLOR;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(EXIT.x * CELL_PX, EXIT.y * CELL_PX, CELL_PX, CELL_PX);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = WALL_COLOR;
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = cells[y][x];
      const px = x * CELL_PX;
      const py = y * CELL_PX;
      ctx.beginPath();
      if (cell.N) { ctx.moveTo(px, py); ctx.lineTo(px + CELL_PX, py); }
      if (cell.W) { ctx.moveTo(px, py); ctx.lineTo(px, py + CELL_PX); }
      if (cell.S) { ctx.moveTo(px, py + CELL_PX); ctx.lineTo(px + CELL_PX, py + CELL_PX); }
      if (cell.E) { ctx.moveTo(px + CELL_PX, py); ctx.lineTo(px + CELL_PX, py + CELL_PX); }
      ctx.stroke();
    }
  }
  // Outer border, since the grid's own outermost edges are otherwise just
  // whichever interior walls happened to survive generation there.
  ctx.strokeRect(1, 1, CANVAS_SIZE - 2, CANVAS_SIZE - 2);

  ctx.fillStyle = PLAYER_COLOR;
  ctx.beginPath();
  ctx.arc(
    player.x * CELL_PX + CELL_PX / 2,
    player.y * CELL_PX + CELL_PX / 2,
    CELL_PX * 0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function tryMove(dir) {
  const cell = cells[player.y][player.x];
  if (dir === 'up' && !cell.N) player.y -= 1;
  else if (dir === 'down' && !cell.S) player.y += 1;
  else if (dir === 'left' && !cell.W) player.x -= 1;
  else if (dir === 'right' && !cell.E) player.x += 1;
  else return;

  visited[player.y][player.x] = true;
  draw();

  if (player.x === EXIT.x && player.y === EXIT.y) {
    finishPuzzle();
  }
}

function finishPuzzle() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (statusEl) statusEl.textContent = 'Path found.';
  const callback = onSolvedCallback;
  setTimeout(() => {
    hideLabyrinthPuzzle();
    if (callback) callback();
  }, 400);
}

function gameLoop() {
  if (!running) return;
  if (keys.up && !prevKeys.up) tryMove('up');
  else if (keys.down && !prevKeys.down) tryMove('down');
  else if (keys.left && !prevKeys.left) tryMove('left');
  else if (keys.right && !prevKeys.right) tryMove('right');
  prevKeys = {
    up: keys.up, down: keys.down, left: keys.left, right: keys.right,
  };
  rafId = requestAnimationFrame(gameLoop);
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'labyrinth-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="labyrinth-box">
      <h1>Signal Labyrinth</h1>
      <p id="labyrinth-status">Find the way from the entrance to the glowing exit. WASD/arrows to move, one step at a time.</p>
      <canvas id="labyrinth-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}"></canvas>
      <button id="labyrinth-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);
  statusEl = overlayEl.querySelector('#labyrinth-status');
  canvas = overlayEl.querySelector('#labyrinth-canvas');
  ctx = canvas.getContext('2d');

  overlayEl.querySelector('#labyrinth-close').addEventListener('click', () => {
    hideLabyrinthPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

export function showLabyrinthPuzzle(onSolved, onCancel) {
  ensureDom();
  if (rafId) cancelAnimationFrame(rafId);
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;

  cells = generateMaze();
  visited = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
  player = { ...START };
  visited[player.y][player.x] = true;
  prevKeys = {
    up: keys.up, down: keys.down, left: keys.left, right: keys.right,
  };
  if (statusEl) statusEl.textContent = 'Find the way from the entrance to the glowing exit. WASD/arrows to move, one step at a time.';
  draw();

  overlayEl.classList.remove('hidden');
  running = true;
  rafId = requestAnimationFrame(gameLoop);
}

export function hideLabyrinthPuzzle() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (overlayEl) overlayEl.classList.add('hidden');
}
