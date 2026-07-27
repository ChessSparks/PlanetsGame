import { duckMusic } from './audio.js';

// Speaks lines aloud via the browser's built-in speech synthesis (no audio
// assets needed). Silently does nothing if unsupported. Must be triggered
// from a user gesture (e.g. a button click) for some browsers to allow it.
//
// Voice quality is entirely up to what the OS/browser ships — the classic
// default voices (e.g. Windows' "Microsoft David/Zira") sound flatly
// robotic, while newer cloud-backed "Online (Natural)" voices (Edge on
// Windows 11) or platform voices like "Google US English"/"Samantha" sound
// far more natural. This picks the best one available for Corthana, and
// avoids the artificially low pitch that reads as synthetic.
const CORTHANA_VOICE_NAMES = [
  'Online (Natural)', // matches any "Microsoft <Name> Online (Natural)" voice (Edge/Windows 11)
  'Google US English',
  'Google UK English Female',
  'Samantha',
  'Microsoft Zira',
  'Microsoft David',
];

let corthanaVoice = null;

function pickVoiceFrom(names, voices) {
  for (const name of names) {
    const match = voices.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return null;
}

function refreshVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  corthanaVoice = pickVoiceFrom(CORTHANA_VOICE_NAMES, voices)
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
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }
  duckMusic(false); // in case a cancelled utterance's onend never fired
  window.speechSynthesis.cancel();
  speakWith(text, corthanaVoice, 1.0, 1.0, onEnd);
}
