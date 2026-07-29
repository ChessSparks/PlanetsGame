import { keys } from './input.js';

// 'pointer: coarse' is true for touchscreens (finger input) and false for
// mice/trackpads, including on touch-capable laptops with a mouse attached —
// a better signal for "should show on-screen controls" than just checking
// for touch support, since e.g. touchscreen Windows laptops are still
// primarily mouse-driven.
export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

const JOYSTICK_MAX = 46; // px the stick can travel from its base's center
const DEADZONE = 0.18; // fraction of JOYSTICK_MAX before a direction registers
const RUN_THRESHOLD = 0.72; // fraction of JOYSTICK_MAX beyond which movement counts as a run

let built = false;

function findTouch(touchList, id) {
  for (let i = 0; i < touchList.length; i++) {
    if (touchList[i].identifier === id) return touchList[i];
  }
  return null;
}

// Maps the stick's drag vector straight onto the same keys.up/down/left/right
// booleans the keyboard sets — every scene already reads only from `keys`,
// so no scene code needs to know controls came from touch instead of WASD.
function setupJoystick(base, stick) {
  let touchId = null;
  let centerX = 0;
  let centerY = 0;

  function reset() {
    touchId = null;
    stick.style.transform = 'translate(0px, 0px)';
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
    keys.shift = false;
  }

  function updateFromTouch(touch) {
    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const clamped = Math.min(dist, JOYSTICK_MAX);
    const stickX = (dx / dist) * clamped;
    const stickY = (dy / dist) * clamped;
    stick.style.transform = `translate(${stickX}px, ${stickY}px)`;

    const nx = stickX / JOYSTICK_MAX;
    const ny = stickY / JOYSTICK_MAX;
    keys.left = nx < -DEADZONE;
    keys.right = nx > DEADZONE;
    keys.up = ny < -DEADZONE;
    keys.down = ny > DEADZONE;
    keys.shift = clamped / JOYSTICK_MAX > RUN_THRESHOLD;
  }

  base.addEventListener('touchstart', (e) => {
    if (touchId !== null) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    touchId = touch.identifier;
    const rect = base.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    updateFromTouch(touch);
  }, { passive: false });

  base.addEventListener('touchmove', (e) => {
    if (touchId === null) return;
    const touch = findTouch(e.changedTouches, touchId);
    if (!touch) return;
    e.preventDefault();
    updateFromTouch(touch);
  }, { passive: false });

  function handleEnd(e) {
    if (touchId === null || !findTouch(e.changedTouches, touchId)) return;
    reset();
  }
  base.addEventListener('touchend', handleEnd);
  base.addEventListener('touchcancel', handleEnd);
}

// Same press/release semantics as a keydown/keyup pair, so the existing
// one-shot consumeJumpPress()/consumeInteractPress() logic in input.js needs
// no changes to work from a tap instead of a key.
function setupButton(el, keyName) {
  let touchId = null;

  el.addEventListener('touchstart', (e) => {
    if (touchId !== null) return;
    e.preventDefault();
    touchId = e.changedTouches[0].identifier;
    keys[keyName] = true;
    el.classList.add('active');
  }, { passive: false });

  function release(e) {
    if (touchId === null || !findTouch(e.changedTouches, touchId)) return;
    touchId = null;
    keys[keyName] = false;
    el.classList.remove('active');
  }
  el.addEventListener('touchend', release);
  el.addEventListener('touchcancel', release);
}

// Builds the on-screen joystick + action buttons once, only for touch-primary
// devices — every scene keeps reading `keys` exactly as it does for the
// keyboard, so this is the only file that needs to know mobile controls exist.
export function initTouchControls() {
  if (built || !isTouchDevice()) return;
  built = true;

  const root = document.createElement('div');
  root.id = 'touch-controls';
  root.innerHTML = `
    <div id="tc-joystick"><div id="tc-stick"></div></div>
    <div id="tc-actions">
      <button id="tc-jump" class="tc-btn" type="button">JUMP</button>
      <button id="tc-interact" class="tc-btn" type="button">E</button>
    </div>
  `;
  document.body.appendChild(root);

  setupJoystick(root.querySelector('#tc-joystick'), root.querySelector('#tc-stick'));
  setupButton(root.querySelector('#tc-jump'), 'jump');
  setupButton(root.querySelector('#tc-interact'), 'interact');
}
