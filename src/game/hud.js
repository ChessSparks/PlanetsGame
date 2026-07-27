const fuelFill = document.getElementById('fuel-fill');
const altitudeFill = document.getElementById('altitude-fill');
const cellsCount = document.getElementById('cells-count');
const cellsTotal = document.getElementById('cells-total');
const barGroups = document.querySelectorAll('.bar-group .bar-label');
const [fuelLabel, altitudeLabel] = barGroups;

const hud = document.getElementById('hud');

const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');
const loadingBarFill = document.getElementById('loading-bar-fill');

export function setLoadingProgress(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  loadingBarFill.style.width = `${clamped}%`;
  loadingText.textContent = `Loading assets… ${Math.round(clamped)}%`;
}

export function hideLoadingScreen() {
  loadingScreen.classList.add('hidden');
}

export function showLoadingScreen() {
  loadingScreen.classList.remove('hidden');
}

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

let choiceOverlayEl = null;

// A reusable N-button prompt (message-overlay only ever has one button) —
// built for the level 4 "hand over the crystals / refuse" branch point, but
// generic enough for any future binary/multi-choice story beat.
export function showChoiceOverlay(title, body, options) {
  if (!choiceOverlayEl) {
    choiceOverlayEl = document.createElement('div');
    choiceOverlayEl.id = 'choice-overlay';
    choiceOverlayEl.className = 'hidden';
    choiceOverlayEl.innerHTML = `
      <div id="choice-box">
        <h1 id="choice-title"></h1>
        <p id="choice-body"></p>
        <div id="choice-buttons"></div>
      </div>
    `;
    document.body.appendChild(choiceOverlayEl);
  }
  choiceOverlayEl.querySelector('#choice-title').textContent = title;
  choiceOverlayEl.querySelector('#choice-body').textContent = body;
  const buttonsEl = choiceOverlayEl.querySelector('#choice-buttons');
  buttonsEl.innerHTML = '';
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = opt.danger ? 'choice-btn danger' : 'choice-btn';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      choiceOverlayEl.classList.add('hidden');
      opt.onSelect();
    });
    buttonsEl.appendChild(btn);
  }
  choiceOverlayEl.classList.remove('hidden');
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
      display: flex; align-items: flex-start; gap: 12px;
      background: rgba(6,14,32,0.9); color: #eaf6ff; padding: 10px 26px 12px 12px;
      border-radius: 12px; border: 1px solid rgba(120,200,255,0.4);
      text-align: left; max-width: 460px; pointer-events: none; z-index: 18;
      transition: opacity 0.4s ease; box-shadow: 0 0 30px rgba(80,180,255,0.2);
    `;
    el.innerHTML = `
      <img src="/assets/images/cortana-ai.png" alt="" style="
        width: 36px; height: 36px; border-radius: 50%; object-fit: cover;
        flex-shrink: 0; margin-top: 1px; border: 1px solid rgba(120,200,255,0.6);
        box-shadow: 0 0 12px rgba(80,180,255,0.6);
      ">
      <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0;">
        <span style="
          font-size: 11px; font-weight: 700; letter-spacing: 1.6px;
          text-transform: uppercase; color: #7fd8ff;
        ">Corthana</span>
        <span id="objective-text" style="
          font-size: 14.5px; font-weight: 500; line-height: 1.4; color: #eaf6ff;
        "></span>
      </div>
    `;
    document.body.appendChild(el);
  }
  el.querySelector('#objective-text').textContent = text;
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
