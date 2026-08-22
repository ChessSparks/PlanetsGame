// "Signal Decoder" — a small 4x4 sudoku (2x2 boxes, digits 1-4) given to
// the player by the last alien in Smite Colony. Distinct mechanic from
// every other puzzle in the game (matching pairs, maze-chase, Flappy Bird,
// sliding tiles, rotate-connect, code-deduction) — this is straightforward
// constraint-filling, picked specifically because it's the one classic
// puzzle type not already used anywhere else. Same lazy-DOM, paused-scene,
// onCancel pattern as memoryMatchPuzzle.js/signalMazePuzzle.js.
const SIZE = 4;
const CELL_COUNT = SIZE * SIZE;
const CLUE_COUNT = 8; // givens out of 16 — leaves 8 for the player to fill in

let overlayEl = null;
let cellEls = [];
let given = []; // true = pre-filled clue, not editable
let values = []; // 0 = empty, else 1-4
let onSolvedCallback = null;
let onCancelCallback = null;

// Starts from one known-valid 4x4 grid, then randomizes it via operations
// that preserve validity: relabeling the four digits, and swapping rows (or
// columns) within a band/stack, or swapping bands/stacks wholesale — every
// row, column, and 2x2 box stays a permutation of 1-4 throughout.
function generateSolution() {
  let grid = [
    [1, 2, 3, 4],
    [3, 4, 1, 2],
    [2, 1, 4, 3],
    [4, 3, 2, 1],
  ];

  const labels = [1, 2, 3, 4];
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  grid = grid.map((row) => row.map((v) => labels[v - 1]));

  if (Math.random() < 0.5) [grid[0], grid[1]] = [grid[1], grid[0]];
  if (Math.random() < 0.5) [grid[2], grid[3]] = [grid[3], grid[2]];
  if (Math.random() < 0.5) grid = [grid[2], grid[3], grid[0], grid[1]];

  function swapCols(g, c1, c2) {
    for (let r = 0; r < SIZE; r++) [g[r][c1], g[r][c2]] = [g[r][c2], g[r][c1]];
  }
  if (Math.random() < 0.5) swapCols(grid, 0, 1);
  if (Math.random() < 0.5) swapCols(grid, 2, 3);
  if (Math.random() < 0.5) {
    grid = grid.map((row) => [row[2], row[3], row[0], row[1]]);
  }

  return grid.flat();
}

function isCompleteAndValid() {
  if (values.some((v) => !v)) return false;
  const isPermOf1to4 = (arr) => new Set(arr).size === SIZE && arr.every((v) => v >= 1 && v <= SIZE);
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) row.push(values[r * SIZE + c]);
    if (!isPermOf1to4(row)) return false;
  }
  for (let c = 0; c < SIZE; c++) {
    const col = [];
    for (let r = 0; r < SIZE; r++) col.push(values[r * SIZE + c]);
    if (!isPermOf1to4(col)) return false;
  }
  for (let br = 0; br < SIZE; br += 2) {
    for (let bc = 0; bc < SIZE; bc += 2) {
      const box = [
        values[br * SIZE + bc], values[br * SIZE + bc + 1],
        values[(br + 1) * SIZE + bc], values[(br + 1) * SIZE + bc + 1],
      ];
      if (!isPermOf1to4(box)) return false;
    }
  }
  return true;
}

function renderCell(i) {
  const el = cellEls[i];
  el.textContent = values[i] || '';
  el.classList.toggle('sudoku-given', given[i]);
  el.disabled = given[i];
}

function handleCellClick(i) {
  if (given[i]) return;
  values[i] = values[i] >= SIZE ? 0 : values[i] + 1;
  renderCell(i);
  if (isCompleteAndValid()) {
    const callback = onSolvedCallback;
    setTimeout(() => {
      hideSudokuPuzzle();
      if (callback) callback();
    }, 350);
  }
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'sudoku-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="sudoku-box">
      <h1>Signal Decoder</h1>
      <p>The alien's chatter resolves into a grid. Fill every empty cell so each row, column, and 2×2 box
      contains 1-4 exactly once. Click a cell to cycle through numbers.</p>
      <div id="sudoku-grid"></div>
      <button id="sudoku-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const grid = overlayEl.querySelector('#sudoku-grid');
  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / SIZE);
    const col = i % SIZE;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'sudoku-cell';
    // Shades alternating 2x2 boxes so the box boundaries read at a glance —
    // (box row + box col) even/odd, same idea as a checkerboard.
    if ((Math.floor(row / 2) + Math.floor(col / 2)) % 2 === 1) {
      cell.classList.add('sudoku-shaded');
    }
    cell.addEventListener('click', () => handleCellClick(i));
    grid.appendChild(cell);
    cellEls.push(cell);
  }

  overlayEl.querySelector('#sudoku-close').addEventListener('click', () => {
    hideSudokuPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

export function showSudokuPuzzle(onSolved, onCancel) {
  ensureDom();
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;

  const solution = generateSolution();
  const indices = Array.from({ length: CELL_COUNT }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const givenIndices = new Set(indices.slice(0, CLUE_COUNT));

  given = Array.from({ length: CELL_COUNT }, (_, i) => givenIndices.has(i));
  values = Array.from({ length: CELL_COUNT }, (_, i) => (given[i] ? solution[i] : 0));

  for (let i = 0; i < CELL_COUNT; i++) renderCell(i);
  overlayEl.classList.remove('hidden');
}

export function hideSudokuPuzzle() {
  if (overlayEl) overlayEl.classList.add('hidden');
}
