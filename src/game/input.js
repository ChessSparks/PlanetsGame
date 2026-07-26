export const keys = {
  up: false, down: false, left: false, right: false,
  shift: false, interact: false, jump: false,
};

let interactConsumed = false;
let jumpConsumed = false;

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = true;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = true;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
    if (e.code === 'KeyE') keys.interact = true;
    if (e.code === 'Space') {
      keys.jump = true;
      e.preventDefault(); // stop the page from scrolling on spacebar
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
    if (e.code === 'KeyE') keys.interact = false;
    if (e.code === 'Space') keys.jump = false;
  });
}

// Interact should trigger once per press, not repeat every frame while held.
export function consumeInteractPress() {
  if (keys.interact && !interactConsumed) {
    interactConsumed = true;
    return true;
  }
  if (!keys.interact) interactConsumed = false;
  return false;
}

// Same one-shot-per-press behavior for jump, so holding Space doesn't rebound endlessly.
export function consumeJumpPress() {
  if (keys.jump && !jumpConsumed) {
    jumpConsumed = true;
    return true;
  }
  if (!keys.jump) jumpConsumed = false;
  return false;
}
