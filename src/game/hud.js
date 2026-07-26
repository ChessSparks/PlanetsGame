const fuelFill = document.getElementById('fuel-fill');
const altitudeFill = document.getElementById('altitude-fill');
const cellsCount = document.getElementById('cells-count');
const cellsTotal = document.getElementById('cells-total');
const barGroups = document.querySelectorAll('.bar-group .bar-label');
const [fuelLabel, altitudeLabel] = barGroups;

const hud = document.getElementById('hud');

const overlay = document.getElementById('message-overlay');
const messageTitle = document.getElementById('message-title');
const messageBody = document.getElementById('message-body');
const messageButton = document.getElementById('message-button');

export function setBarLabels(topLabel, bottomLabel) {
  fuelLabel.textContent = topLabel;
  altitudeLabel.textContent = bottomLabel;
}

export function setTopBar(percent) {
  fuelFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

export function setBottomBar(percent) {
  altitudeFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

export function setCellsCount(current, total) {
  cellsCount.textContent = String(current);
  cellsTotal.textContent = String(total);
}

export function hideHud() {
  hud.style.display = 'none';
}

export function showHud() {
  hud.style.display = 'flex';
}

export function showOverlay(title, body, buttonText, onContinue) {
  messageTitle.textContent = title;
  messageBody.textContent = body;
  messageButton.textContent = buttonText;
  overlay.classList.remove('hidden');
  const handler = () => {
    messageButton.removeEventListener('click', handler);
    overlay.classList.add('hidden');
    onContinue();
  };
  messageButton.addEventListener('click', handler);
}

export function hideOverlay() {
  overlay.classList.add('hidden');
}

export function setKeysDisplay(current, total) {
  let el = document.getElementById('keys-counter');
  if (!el) {
    el = document.createElement('div');
    el.id = 'keys-counter';
    el.style.cssText = `
      position: fixed; top: 16px; right: 16px;
      background: rgba(10,18,40,0.75); color: #eaf6ff; padding: 8px 18px;
      border-radius: 10px; border: 1px solid rgba(120,180,255,0.35);
      font-size: 14px; font-weight: 600; letter-spacing: 0.4px;
      pointer-events: none; z-index: 15;
    `;
    document.body.appendChild(el);
  }
  el.textContent = `\u{1F5DD} Keys: ${current} / ${total}`;
}

export function hideKeysDisplay() {
  const el = document.getElementById('keys-counter');
  if (el) el.remove();
}

export function announceObjective(text) {
  let el = document.getElementById('objective-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'objective-banner';
    el.style.cssText = `
      position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
      background: rgba(6,14,32,0.88); color: #9be8ff; padding: 12px 28px;
      border-radius: 12px; border: 1px solid rgba(120,200,255,0.4);
      font-size: 15px; font-weight: 600; letter-spacing: 0.3px; text-align: center;
      max-width: 520px; pointer-events: none; z-index: 18; transition: opacity 0.4s ease;
      box-shadow: 0 0 30px rgba(80,180,255,0.2);
    `;
    document.body.appendChild(el);
  }
  el.textContent = `\u{1F916} AI: ${text}`;
  el.style.opacity = '1';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 5200);
}

// A quick full-screen white flash — used for cinematic impact beats (e.g.
// the crash cutscene) rather than any regular HUD feedback.
export function flashScreenWhite(duration = 350) {
  let flash = document.getElementById('screen-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'screen-flash';
    flash.style.cssText = `
      position: fixed; inset: 0; background: #fff; opacity: 0;
      pointer-events: none; z-index: 40;
    `;
    document.body.appendChild(flash);
  }
  flash.style.transition = 'none';
  flash.style.opacity = '1';
  requestAnimationFrame(() => {
    flash.style.transition = `opacity ${duration}ms ease-out`;
    flash.style.opacity = '0';
  });
}

export function flashToast(text, duration = 2200) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position: fixed; top: 135px; left: 50%; transform: translateX(-50%);
      background: rgba(10,18,40,0.9); color: #eaf6ff; padding: 10px 22px;
      border-radius: 10px; border: 1px solid rgba(120,180,255,0.35);
      font-size: 14px; font-weight: 600; letter-spacing: 0.3px;
      pointer-events: none; z-index: 20; transition: opacity 0.3s ease;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.opacity = '1';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}
