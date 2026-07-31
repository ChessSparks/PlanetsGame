import { duckMusic } from './audio.js';
import { isTouchDevice } from './touchControls.js';

// Speaks lines aloud via the browser's built-in speech synthesis (no audio
// assets needed). Silently does nothing if unsupported. Must be triggered
// from a user gesture (e.g. a button click) for some browsers to allow it.
//
// Voice quality and speaking rate are entirely up to what the OS/browser
// ships, and different voices speak at very different paces even at the
// same rate=1.0, which made Corthana sound slow on some devices and fast on
// others depending on which voice happened to be picked. Locking to a
// single voice keeps the pace consistent everywhere that voice exists
// (Chrome/Chromium on any OS); devices without it fall back to the default
// English voice below.
const CORTHANA_VOICE_NAME = 'Google US English';

let corthanaVoice = null;
let voiceMuted = false;

// Settings-menu "Mute Voice" toggle — cancels anything mid-utterance so
// muting doesn't just silence future lines but leaves the current one
// finishing out loud.
export function setVoiceMuted(muted) {
  voiceMuted = muted;
  if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    duckMusic(false);
  }
}

function refreshVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  corthanaVoice = voices.find((v) => v.name.includes(CORTHANA_VOICE_NAME))
    || voices.find((v) => v.lang.startsWith('en')) || voices[0];
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  // Voice lists load asynchronously in some browsers — re-pick once ready.
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function speakWith(text, voice, pitch, rate, onEnd) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = 1;
  // Ducking the background music while this plays is what actually makes
  // the voice read as louder — utterance.volume is already at its ceiling.
  duckMusic(true);
  utterance.onend = () => {
    duckMusic(false);
    if (onEnd) onEnd();
  };
  window.speechSynthesis.speak(utterance);
}

// Corthana's voice — cancels anything currently queued/speaking first, so a
// fast string of objective updates doesn't pile up a backlog of stale lines.
export function speak(text, onEnd) {
  if (voiceMuted) {
    if (onEnd) onEnd();
    return;
  }
  // Mobile browsers' speechSynthesis support is spotty (often silent or
  // requires a fresh user gesture per utterance rather than once per
  // session), and text-to-speech competing with on-screen touch controls
  // for the player's attention is a worse experience than just skipping it —
  // Corthana's lines still show as objective/toast text either way.
  if (isTouchDevice()) {
    if (onEnd) onEnd();
    return;
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }
  duckMusic(false); // in case a cancelled utterance's onend never fired
  window.speechSynthesis.cancel();
  speakWith(text, corthanaVoice, 1.0, 1.0, onEnd);
}
