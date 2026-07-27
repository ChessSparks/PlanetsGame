// "Cipher Lock" — a Mastermind-style code-breaking puzzle for the control
// tower's Security Override panel. Build a 4-symbol guess by cycling each
// slot, submit it, and read the feedback pins: a filled pin means a symbol
// is the right color in the right slot, a hollow pin means it's somewhere
// in the code but in the wrong slot. Keep guessing until you get four
// filled pins. Deliberately a logic-deduction mechanic — distinct from the
// sliding-tile reorder (ground fuel puzzle), the memory-sequence repeat
// (moon star chart), and the rotate-to-connect conduits (beacon uplink).
// No guess limit and no fail state, same as the other puzzles: you can
// only solve it or leave. Same lazy-DOM, paused-scene, onCancel pattern.
const CODE_LENGTH = 4;
const SYMBOLS = [
  { color: '#ff5a5a', label: 'A' },
  { color: '#ffb347', label: 'B' },
  { color: '#ffe45c', label: 'C' },
  { color: '#6dffb0', label: 'D' },
  { color: '#4dd0ff', label: 'E' },
];

let overlayEl = null;
let slotEls = [];
let historyEl = null;
let guess = [];
let secret = [];
let onSolvedCallback = null;
let onCancelCallback = null;

function rollSecret() {
  secret = Array.from({ length: CODE_LENGTH }, () => Math.floor(Math.random() * SYMBOLS.length));
}

// Standard Mastermind scoring: exact matches first, then count remaining
// color matches regardless of position (each symbol consumed at most once
// on both sides, so duplicate colors can't inflate the partial count).
function scoreGuess(g) {
  let exact = 0;
  const secretRemain = [];
  const guessRemain = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (g[i] === secret[i]) {
      exact += 1;
    } else {
      secretRemain.push(secret[i]);
      guessRemain.push(g[i]);
    }
  }
  let partial = 0;
  for (const s of guessRemain) {
    const idx = secretRemain.indexOf(s);
    if (idx !== -1) {
      partial += 1;
      secretRemain.splice(idx, 1);
    }
  }
  return { exact, partial };
}

function renderSlots() {
  slotEls.forEach((el, i) => {
    const sym = SYMBOLS[guess[i]];
    el.style.background = sym.color;
    el.textContent = sym.label;
  });
}

function addHistoryRow(g, result) {
  const row = document.createElement('div');
  row.className = 'cipher-history-row';
  const chips = g
    .map((idx) => `<span class="cipher-chip" style="background:${SYMBOLS[idx].color}">${SYMBOLS[idx].label}</span>`)
    .join('');
  const pegCount = { exact: result.exact, partial: result.partial, empty: CODE_LENGTH - result.exact - result.partial };
  const pegs = [
    ...Array(pegCount.exact).fill('<span class="cipher-peg cipher-peg-exact"></span>'),
    ...Array(pegCount.partial).fill('<span class="cipher-peg cipher-peg-partial"></span>'),
    ...Array(pegCount.empty).fill('<span class="cipher-peg"></span>'),
  ].join('');
  row.innerHTML = `<span class="cipher-chips">${chips}</span><span class="cipher-pegs">${pegs}</span>`;
  historyEl.prepend(row);
}

function handleSubmit() {
  const result = scoreGuess(guess);
  addHistoryRow(guess, result);
  if (result.exact === CODE_LENGTH) {
    const callback = onSolvedCallback;
    setTimeout(() => {
      hideCipherPuzzle();
      if (callback) callback();
    }, 500);
  }
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'cipher-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="cipher-box">
      <h1>Security Override</h1>
      <p>Crack the override code. Click a slot to cycle its symbol, then submit — a filled pin means right symbol in the right slot, a hollow pin means right symbol, wrong slot.</p>
      <div id="cipher-slots"></div>
      <button id="cipher-submit" type="button">Submit Guess</button>
      <div id="cipher-history"></div>
      <button id="cipher-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const slotsRow = overlayEl.querySelector('#cipher-slots');
  for (let i = 0; i < CODE_LENGTH; i++) {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'cipher-slot';
    slot.addEventListener('click', () => {
      guess[i] = (guess[i] + 1) % SYMBOLS.length;
      renderSlots();
    });
    slotsRow.appendChild(slot);
    slotEls.push(slot);
  }

  historyEl = overlayEl.querySelector('#cipher-history');

  overlayEl.querySelector('#cipher-submit').addEventListener('click', handleSubmit);
  overlayEl.querySelector('#cipher-close').addEventListener('click', () => {
    hideCipherPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

export function showCipherPuzzle(onSolved, onCancel) {
  ensureDom();
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;
  rollSecret();
  guess = Array(CODE_LENGTH).fill(0);
  historyEl.innerHTML = '';
  renderSlots();
  overlayEl.classList.remove('hidden');
}

export function hideCipherPuzzle() {
  if (overlayEl) overlayEl.classList.add('hidden');
}
