// A classic 4x4 (15-puzzle) sliding tile puzzle, rendered as a DOM overlay
// in the same "create elements lazily, toggle a hidden class" style as the
// rest of the HUD (see hud.js). Solving it is entirely a UI interaction —
// the 3D scene stays paused behind it (see groundScene's 'puzzle' state).
const SIZE = 4;
const SOLVED = Array.from({ length: SIZE * SIZE - 1 }, (_, i) => i + 1).concat(0);

let overlayEl = null;
let gridEl = null;
let onSolvedCallback = null;
let onCancelCallback = null;
let board = [];

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'puzzle-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="puzzle-box">
      <h1>Fuel Cell Lock</h1>
      <p>Slide the tiles to put them back in order (1-15) to release the fuel cell.</p>
      <div id="puzzle-grid"></div>
      <button id="puzzle-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);
  gridEl = overlayEl.querySelector('#puzzle-grid');
  // Distinct from the solved-path close: this is the player bailing out
  // without solving it, so the caller needs its own signal to unpause.
  overlayEl.querySelector('#puzzle-close').addEventListener('click', () => {
    hideSlidingPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

// Shuffles by replaying random legal slides from the solved state, so the
// result is always solvable (a random permutation would be unsolvable half
// the time for a 4x4 board).
function shuffledBoard() {
  const shuffled = SOLVED.slice();
  let blank = shuffled.indexOf(0);
  let lastBlank = -1;
  for (let i = 0; i < 300; i++) {
    const row = Math.floor(blank / SIZE);
    const col = blank % SIZE;
    const neighbors = [];
    if (row > 0) neighbors.push(blank - SIZE);
    if (row < SIZE - 1) neighbors.push(blank + SIZE);
    if (col > 0) neighbors.push(blank - 1);
    if (col < SIZE - 1) neighbors.push(blank + 1);
    const options = neighbors.filter((n) => n !== lastBlank);
    const pick = options[Math.floor(Math.random() * options.length)];
    [shuffled[blank], shuffled[pick]] = [shuffled[pick], shuffled[blank]];
    lastBlank = blank;
    blank = pick;
  }
  return shuffled;
}

function render() {
  gridEl.innerHTML = '';
  board.forEach((value, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = value === 0 ? 'puzzle-tile puzzle-blank' : 'puzzle-tile';
    if (value === 0) {
      tile.disabled = true;
    } else {
      tile.textContent = String(value);
      tile.addEventListener('click', () => tryMove(i));
    }
    gridEl.appendChild(tile);
  });
}

function tryMove(i) {
  const blank = board.indexOf(0);
  const row = Math.floor(i / SIZE);
  const col = i % SIZE;
  const brow = Math.floor(blank / SIZE);
  const bcol = blank % SIZE;
  const adjacent = (row === brow && Math.abs(col - bcol) === 1) || (col === bcol && Math.abs(row - brow) === 1);
  if (!adjacent) return;

  [board[i], board[blank]] = [board[blank], board[i]];
  render();

  if (board.every((v, idx) => v === SOLVED[idx])) {
    const callback = onSolvedCallback;
    setTimeout(() => {
      hideSlidingPuzzle();
      if (callback) callback();
    }, 250);
  }
}

export function showSlidingPuzzle(onSolved, onCancel) {
  ensureDom();
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;
  board = shuffledBoard();
  render();
  overlayEl.classList.remove('hidden');
}

export function hideSlidingPuzzle() {
  if (overlayEl) overlayEl.classList.add('hidden');
}
