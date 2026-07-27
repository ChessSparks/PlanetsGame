import { setMusicVolume, setSfxMuted } from './audio.js';
import { setVoiceMuted } from './voice.js';

let panelEl = null;
let isOpen = false;
let onOpenCb = null;
let onCloseCb = null;

function ensureDom() {
  if (panelEl) return;

  panelEl = document.createElement('div');
  panelEl.id = 'settings-overlay';
  panelEl.className = 'hidden';
  panelEl.innerHTML = `
    <div id="settings-box">
      <h1>Settings</h1>
      <label class="settings-row">
        <span>Music Volume</span>
        <input type="range" id="settings-music-volume" min="0" max="100" value="70">
      </label>
      <label class="settings-row settings-checkbox-row">
        <span>Mute Voice</span>
        <input type="checkbox" id="settings-mute-voice">
      </label>
      <label class="settings-row settings-checkbox-row">
        <span>Mute Sound Effects</span>
        <input type="checkbox" id="settings-mute-sfx">
      </label>
      <div id="settings-hint">Esc to resume</div>
      <button id="settings-resume" type="button">Resume</button>
    </div>
  `;
  document.body.appendChild(panelEl);

  panelEl.querySelector('#settings-music-volume').addEventListener('input', (e) => {
    setMusicVolume(Number(e.target.value) / 100);
  });
  panelEl.querySelector('#settings-mute-voice').addEventListener('change', (e) => {
    setVoiceMuted(e.target.checked);
  });
  panelEl.querySelector('#settings-mute-sfx').addEventListener('change', (e) => {
    setSfxMuted(e.target.checked);
  });
  panelEl.querySelector('#settings-resume').addEventListener('click', close);

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'settings-toggle';
  toggleBtn.type = 'button';
  toggleBtn.textContent = '⚙';
  toggleBtn.style.cssText = `
    position: fixed; top: 14px; right: 14px; z-index: 70;
    width: 36px; height: 36px; border-radius: 8px; border: 1px solid rgba(120,180,255,0.35);
    background: rgba(6,14,32,0.75); color: #eaf6ff; font-size: 18px; cursor: pointer;
  `;
  toggleBtn.addEventListener('click', () => { if (isOpen) close(); else open(); });
  document.body.appendChild(toggleBtn);
}

function open() {
  ensureDom();
  isOpen = true;
  panelEl.classList.remove('hidden');
  onOpenCb?.();
}

function close() {
  if (!panelEl) return;
  isOpen = false;
  panelEl.classList.add('hidden');
  onCloseCb?.();
}

// onOpen/onClose let the caller pause/resume the game loop while the panel
// is up — Escape toggles it from anywhere, same as the gear button.
export function initSettingsMenu({ onOpen, onClose } = {}) {
  onOpenCb = onOpen;
  onCloseCb = onClose;
  ensureDom();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (isOpen) close();
      else open();
    }
  });
}
