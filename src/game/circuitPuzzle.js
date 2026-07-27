// A "patch panel" hacking puzzle — a 3x3 grid of conduit segments, each
// showing 1-2 stub connectors. Click a tile to rotate it 90°; the puzzle is
// solved once every tile's connectors line up into one continuous path from
// the source (top-left) to the target (bottom-right). Distinct mechanic
// from both the sliding-tile puzzle (ground level) and the memory-sequence
// star chart (moon level) — same lazy-DOM, paused-scene, onCancel pattern.
const ORDER = ['N', 'E', 'S', 'W'];

const BASE_DIRS = {
  end: ['E'],
  straight: ['N', 'S'],
  corner: ['N', 'E'],
};

// A fixed snake path covering all 9 cells, source at 0, target at 8.
const CELLS = [
  { type: 'end', target: ['E'] },
  { type: 'straight', target: ['E', 'W'] },
  { type: 'corner', target: ['S', 'W'] },
  { type: 'corner', target: ['E', 'S'] },
  { type: 'straight', target: ['E', 'W'] },
  { type: 'corner', target: ['N', 'W'] },
  { type: 'corner', target: ['N', 'E'] },
  { type: 'straight', target: ['E', 'W'] },
  { type: 'end', target: ['W'] },
];

function rotateDirs(dirs, steps) {
  return dirs.map((d) => ORDER[(ORDER.indexOf(d) + steps) % 4]);
}

function dirsEqual(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function currentDirs(i) {
  return rotateDirs(BASE_DIRS[CELLS[i].type], rotation[i]);
}

function isCellSolved(i) {
  return dirsEqual(currentDirs(i), CELLS[i].target);
}

let overlayEl = null;
let cellEls = [];
let innerEls = [];
let rotation = [];
let onSolvedCallback = null;
let onCancelCallback = null;

function armStyle(dir) {
  // Positions a thin bar from the cell's center out to the given edge —
  // these describe the BASE (0-rotation) shape; the whole inner wrapper is
  // then CSS-rotated per the tile's current rotation state.
  switch (dir) {
    case 'N': return 'left: 50%; top: 0; width: 8px; height: 52%; transform: translateX(-50%);';
    case 'S': return 'left: 50%; bottom: 0; width: 8px; height: 52%; transform: translateX(-50%);';
    case 'E': return 'top: 50%; right: 0; height: 8px; width: 52%; transform: translateY(-50%);';
    default: return 'top: 50%; left: 0; height: 8px; width: 52%; transform: translateY(-50%);'; // W
  }
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'circuit-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="circuit-box">
      <h1>Security Override</h1>
      <p>Rotate each conduit to patch a line from the source to the target.</p>
      <div id="circuit-grid"></div>
      <button id="circuit-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const grid = overlayEl.querySelector('#circuit-grid');
  CELLS.forEach((cell, i) => {
    const cellEl = document.createElement('button');
    cellEl.type = 'button';
    cellEl.className = 'circuit-cell';

    const inner = document.createElement('div');
    inner.className = 'circuit-cell-inner';
    inner.innerHTML = '<div class="circuit-hub"></div>';
    for (const dir of BASE_DIRS[cell.type]) {
      const arm = document.createElement('div');
      arm.className = 'circuit-arm';
      arm.style.cssText = armStyle(dir);
      inner.appendChild(arm);
    }
    cellEl.appendChild(inner);

    if (cell.target.length === 1) cellEl.classList.add('circuit-endpoint');
    cellEl.addEventListener('click', () => handleClick(i));
    grid.appendChild(cellEl);
    cellEls.push(cellEl);
    innerEls.push(inner);
  });

  overlayEl.querySelector('#circuit-close').addEventListener('click', () => {
    hideCircuitPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

function render() {
  CELLS.forEach((cell, i) => {
    innerEls[i].style.transform = `rotate(${rotation[i] * 90}deg)`;
    cellEls[i].classList.toggle('circuit-solved', isCellSolved(i));
  });
}

function handleClick(i) {
  rotation[i] = (rotation[i] + 1) % 4;
  render();
  if (CELLS.every((_, idx) => isCellSolved(idx))) {
    const callback = onSolvedCallback;
    setTimeout(() => {
      hideCircuitPuzzle();
      if (callback) callback();
    }, 350);
  }
}

function randomizeRotations() {
  rotation = CELLS.map((_, i) => {
    let r = Math.floor(Math.random() * 4);
    // Re-roll if the random pick happens to already render as solved
    // (common for symmetric pieces like straights, which have two
    // rotations that look identical) — the puzzle should never start solved.
    for (let guard = 0; guard < 8 && dirsEqual(rotateDirs(BASE_DIRS[CELLS[i].type], r), CELLS[i].target); guard += 1) {
      r = Math.floor(Math.random() * 4);
    }
    return r;
  });
}

export function showCircuitPuzzle(onSolved, onCancel) {
  ensureDom();
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;
  randomizeRotations();
  render();
  overlayEl.classList.remove('hidden');
}

export function hideCircuitPuzzle() {
  if (overlayEl) overlayEl.classList.add('hidden');
}
