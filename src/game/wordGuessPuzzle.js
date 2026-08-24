// A small Wordle clone — guess the hidden word letter by letter, with
// green/yellow/gray feedback after each guess, in a fixed number of
// attempts. `targetWord` is passed in by the caller (not hardcoded here)
// so this stays reusable rather than tied to one specific answer — Veyra
// Station uses it to hand out a piece of a buyer's name, but nothing in
// this file itself knows that. Distinct mechanic from every other puzzle
// in the game: letter-position deduction from repeated guesses, not
// memory, maze navigation, reordering, connecting, or a reflex/timing
// game. No real-word dictionary check on guesses (this is a made-up name,
// not a word list the game ships) — any string of the right length is
// accepted, keeping this deliberately simple. Running out of attempts
// resets the board (fresh empty grid, same target, tries back to full) —
// same "no fail state" spirit as every other puzzle here — rather than
// failing outright.
const MAX_ATTEMPTS = 6;

let overlayEl = null;
let gridEl = null;
let statusEl = null;
let cellEls = []; // cellEls[row][col]

let targetWord = '';
let wordLength = 0;
let attempts = []; // finished guesses, each a string
let currentGuess = '';

let onSolvedCallback = null;
let onCancelCallback = null;
let keydownHandler = null;

// Standard two-pass Wordle scoring: exact matches first (so a repeated
// letter in the guess doesn't double-claim a single occurrence in the
// target), then whatever's left over checked for "present, wrong spot".
function scoreGuess(guess) {
  const result = new Array(wordLength).fill('absent');
  const remaining = {};
  for (let i = 0; i < wordLength; i++) {
    if (guess[i] === targetWord[i]) {
      result[i] = 'correct';
    } else {
      remaining[targetWord[i]] = (remaining[targetWord[i]] || 0) + 1;
    }
  }
  for (let i = 0; i < wordLength; i++) {
    if (result[i] === 'correct') continue;
    const letter = guess[i];
    if (remaining[letter] > 0) {
      result[i] = 'present';
      remaining[letter] -= 1;
    }
  }
  return result;
}

function renderRow(row) {
  const guess = row < attempts.length ? attempts[row] : (row === attempts.length ? currentGuess : '');
  const scored = row < attempts.length ? scoreGuess(attempts[row]) : null;
  for (let col = 0; col < wordLength; col++) {
    const cell = cellEls[row][col];
    cell.textContent = guess[col] || '';
    cell.classList.remove('wordguess-correct', 'wordguess-present', 'wordguess-absent', 'wordguess-filled');
    if (scored) {
      cell.classList.add(`wordguess-${scored[col]}`);
    } else if (guess[col]) {
      cell.classList.add('wordguess-filled');
    }
  }
}

function renderAll() {
  for (let row = 0; row < MAX_ATTEMPTS; row++) renderRow(row);
}

function resetBoard() {
  attempts = [];
  currentGuess = '';
  renderAll();
}

function finishPuzzle() {
  if (statusEl) statusEl.textContent = 'Solved.';
  const callback = onSolvedCallback;
  setTimeout(() => {
    hideWordGuessPuzzle();
    if (callback) callback();
  }, 500);
}

function submitGuess() {
  if (currentGuess.length !== wordLength) {
    if (statusEl) statusEl.textContent = `Needs to be ${wordLength} letters.`;
    return;
  }
  attempts.push(currentGuess);
  const solved = currentGuess === targetWord;
  currentGuess = '';
  renderAll();
  if (solved) {
    finishPuzzle();
    return;
  }
  if (attempts.length >= MAX_ATTEMPTS) {
    if (statusEl) statusEl.textContent = 'Out of attempts — board reset, try again.';
    setTimeout(resetBoard, 900);
    return;
  }
  if (statusEl) statusEl.textContent = `${MAX_ATTEMPTS - attempts.length} attempts left.`;
}

function handleKeydown(e) {
  if (attempts.length >= MAX_ATTEMPTS) return; // mid-reset pause
  if (e.key === 'Enter') {
    submitGuess();
    return;
  }
  if (e.key === 'Backspace') {
    currentGuess = currentGuess.slice(0, -1);
    renderRow(attempts.length);
    return;
  }
  if (/^[a-zA-Z]$/.test(e.key) && currentGuess.length < wordLength) {
    currentGuess += e.key.toUpperCase();
    renderRow(attempts.length);
  }
}

function buildGridDom() {
  gridEl.innerHTML = '';
  gridEl.style.gridTemplateColumns = `repeat(${wordLength}, 42px)`;
  gridEl.style.gridTemplateRows = `repeat(${MAX_ATTEMPTS}, 42px)`;
  cellEls = [];
  for (let row = 0; row < MAX_ATTEMPTS; row++) {
    const rowEls = [];
    for (let col = 0; col < wordLength; col++) {
      const cell = document.createElement('div');
      cell.className = 'wordguess-cell';
      gridEl.appendChild(cell);
      rowEls.push(cell);
    }
    cellEls.push(rowEls);
  }
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'wordguess-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="wordguess-box">
      <h1>Redacted Record</h1>
      <p id="wordguess-status">Type letters, Enter to submit, Backspace to correct. Green = right spot, yellow = right letter wrong spot.</p>
      <div id="wordguess-grid"></div>
      <button id="wordguess-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);
  statusEl = overlayEl.querySelector('#wordguess-status');
  gridEl = overlayEl.querySelector('#wordguess-grid');

  overlayEl.querySelector('#wordguess-close').addEventListener('click', () => {
    hideWordGuessPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

export function showWordGuessPuzzle(word, onSolved, onCancel) {
  ensureDom();
  targetWord = word.toUpperCase();
  wordLength = targetWord.length;
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;

  buildGridDom();
  attempts = [];
  currentGuess = '';
  if (statusEl) {
    statusEl.textContent = 'Type letters, Enter to submit, Backspace to correct. Green = right spot, yellow = right letter wrong spot.';
  }
  renderAll();

  overlayEl.classList.remove('hidden');
  if (keydownHandler) window.removeEventListener('keydown', keydownHandler);
  keydownHandler = handleKeydown;
  window.addEventListener('keydown', keydownHandler);
}

export function hideWordGuessPuzzle() {
  if (overlayEl) overlayEl.classList.add('hidden');
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
}
