// A Simon-Says-style memory sequence over a ring of star nodes — distinct
// mechanic from the 15-puzzle used on the ground level, themed as
// "triangulating" the crystal deposit locations. Same DOM-overlay,
// paused-scene pattern as puzzle.js, including a proper cancel path (the
// ground-level puzzle originally shipped without one and froze the game
// when the player clicked "Leave" — showSlidingPuzzle/onCancel fixed that,
// so this one supports cancellation from the start).
const NODE_COUNT = 6;
const SEQUENCE_LENGTH = 5;
const FLASH_ON_MS = 450;
const FLASH_GAP_MS = 220;
const RING_RADIUS = 90;
const NODE_SIZE = 40;

let overlayEl = null;
let statusEl = null;
let nodeEls = [];
let onSolvedCallback = null;
let onCancelCallback = null;
let sequence = [];
let playerIndex = 0;
let accepting = false;
let playToken = 0; // bumped to cancel any in-flight playSequence() when the puzzle is hidden/reset

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'starchart-overlay';
  overlayEl.className = 'hidden';
  overlayEl.innerHTML = `
    <div id="starchart-box">
      <h1>Star Chart</h1>
      <p id="starchart-status">Watch the pattern, then repeat it.</p>
      <div id="starchart-ring"></div>
      <button id="starchart-close" type="button">Leave</button>
    </div>
  `;
  document.body.appendChild(overlayEl);
  statusEl = overlayEl.querySelector('#starchart-status');

  const ring = overlayEl.querySelector('#starchart-ring');
  for (let i = 0; i < NODE_COUNT; i++) {
    const angle = (i / NODE_COUNT) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * RING_RADIUS;
    const y = Math.sin(angle) * RING_RADIUS;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'starchart-node';
    node.style.left = `calc(50% + ${x}px - ${NODE_SIZE / 2}px)`;
    node.style.top = `calc(50% + ${y}px - ${NODE_SIZE / 2}px)`;
    node.addEventListener('click', () => handleNodeClick(i));
    ring.appendChild(node);
    nodeEls.push(node);
  }

  overlayEl.querySelector('#starchart-close').addEventListener('click', () => {
    hideStarChart();
    if (onCancelCallback) onCancelCallback();
  });
}

function setLit(index, on) {
  nodeEls[index].classList.toggle('lit', on);
}

async function playSequence() {
  const token = ++playToken;
  accepting = false;
  setStatus('Watch closely…');
  await sleep(500);
  for (const idx of sequence) {
    if (token !== playToken) return; // puzzle was hidden/reset mid-playback
    setLit(idx, true);
    await sleep(FLASH_ON_MS);
    if (token !== playToken) return;
    setLit(idx, false);
    await sleep(FLASH_GAP_MS);
  }
  if (token !== playToken) return;
  playerIndex = 0;
  accepting = true;
  setStatus('Your turn — repeat the pattern.');
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function handleNodeClick(i) {
  if (!accepting) return;
  setLit(i, true);
  setTimeout(() => setLit(i, false), 200);

  if (i === sequence[playerIndex]) {
    playerIndex += 1;
    if (playerIndex === sequence.length) {
      accepting = false;
      setStatus('Pattern confirmed.');
      const callback = onSolvedCallback;
      setTimeout(() => {
        hideStarChart();
        if (callback) callback();
      }, 500);
    }
  } else {
    accepting = false;
    setStatus('Pattern broken — watch again.');
    setTimeout(() => playSequence(), 700);
  }
}

function generateSequence() {
  sequence = Array.from({ length: SEQUENCE_LENGTH }, () => Math.floor(Math.random() * NODE_COUNT));
}

export function showStarChart(onSolved, onCancel) {
  ensureDom();
  onSolvedCallback = onSolved;
  onCancelCallback = onCancel;
  generateSequence();
  overlayEl.classList.remove('hidden');
  playSequence();
}

export function hideStarChart() {
  playToken += 1; // stop any in-flight playback
  accepting = false;
  if (overlayEl) overlayEl.classList.add('hidden');
}
