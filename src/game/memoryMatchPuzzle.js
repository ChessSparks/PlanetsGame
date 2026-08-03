// "Data Fragments" — a concentration/pair-matching grid: flip two tiles at
// a time, a match locks both face-up, a mismatch flips them back after a
// beat. Distinct mechanic from every other puzzle in the game: not a
// sliding reorder (ground fuel puzzle), not a sequence-repeat (moon star
// chart), not a rotate-to-connect (client-world beacon uplink), not a
// code-deduction (client-world cipher lock) — this is spatial recall over
// hidden pairs. Same lazy-DOM, paused-scene, onCancel pattern as the others.
const PAIR_COUNT = 6;
const SYMBOLS = ['◆', '◈', '✦', '☉', '❖', '⬡', '△', '◐'];
const MISMATCH_DELAY_MS = 700;

let overlayEl = null;
let cardEls = [];
let cardValues = [];
let revealed = []; // true once a pair is permanently matched
let flipped = []; // indices currently face-up but not yet resolved (max 2)
let onSolvedCallback = null;
let onCancelCallback = null;
let matchedCount = 0;
let accepting = true;

function buildDeck() {
  const chosen = SYMBOLS.slice(0, PAIR_COUNT);
  const deck = [...chosen, ...chosen];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function renderCard(i) {
  const el = cardEls[i];
  const isUp = revealed[i] || flipped.includes(i);
  el.textContent = isUp ? cardValues[i] : '';
  el.classList.toggle('memorymatch-up', isUp);
  el.classList.toggle('memorymatch-matched', revealed[i]);
}

function handleCardClick(i) {
  if (!accepting || revealed[i] || flipped.includes(i) || flipped.length >= 2) return;
  flipped.push(i);
  renderCard(i);
  if (flipped.length < 2) return;

  accepting = false;
  const [a, b] = flipped;
  if (cardValues[a] === cardValues[b]) {
    revealed[a] = true;
    revealed[b] = true;
    matchedCount += 1;
    flipped = [];
    renderCard(a);
    renderCard(b);
    accepting = true;
    if (matchedCount === PAIR_COUNT) {
      const callback = onSolvedCallback;
      setTimeout(() => {
        hideMemoryMatchPuzzle();
        if (callback) callback();
      }, 400);
    }
  } else {
    setTimeout(() => {
      flipped = [];
      renderCard(a);
      renderCard(b);
      accepting = true;
    }, MISMATCH_DELAY_MS);
  }
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'memorymatch-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="memorymatch-box">
      <h1>Data Fragments</h1>
      <p>Match the corresponding fragment pairs to reassemble the record.</p>
      <div id="memorymatch-grid"></div>
      <button id="memorymatch-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const grid = overlayEl.querySelector('#memorymatch-grid');
  for (let i = 0; i < PAIR_COUNT * 2; i++) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'memorymatch-card';
    card.addEventListener('click', () => handleCardClick(i));
    grid.appendChild(card);
    cardEls.push(card);
  }

  overlayEl.querySelector('#memorymatch-close').addEventListener('click', () => {
    hideMemoryMatchPuzzle();
    if (onCancelCallback) onCancelCallback();
  });
}

export function showMemoryMatchPuzzle(onSolved, onCancel) {
  ensureDom();
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;
  cardValues = buildDeck();
  revealed = Array(PAIR_COUNT * 2).fill(false);
  flipped = [];
  matchedCount = 0;
  accepting = true;
  cardEls.forEach((_, i) => renderCard(i));
  overlayEl.classList.remove('hidden');
}

export function hideMemoryMatchPuzzle() {
  if (overlayEl) overlayEl.classList.add('hidden');
}
