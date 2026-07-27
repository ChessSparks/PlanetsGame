// Procedurally synthesized SFX via the Web Audio API — the project has no
// sound asset files, so chime/alert/music are generated tones rather than
// loaded clips. Browsers block audio until a user gesture, so unlockAudio()
// must be called from a click handler (the tutorial overlay's "Begin"
// button) before any of these will actually produce sound.
let ctx = null;

function getContext() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    ctx = AudioContextClass ? new AudioContextClass() : null;
  }
  return ctx;
}

export function unlockAudio() {
  const c = getContext();
  if (c && c.state === 'suspended') c.resume();
}

export function playPickupChime() {
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  [660, 990].forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = c.createGain();
    const start = now + i * 0.08;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

let musicStarted = false;
let musicGain = null;
const MUSIC_LEVEL = 0.045;

// A slowly-breathing ambient pad (a handful of detuned, LFO-modulated
// oscillators sustained forever, no clips/looping needed) — there are no
// music asset files in the project, so this substitutes for a proper score.
// Idempotent and very quiet by design so it sits under the voice/SFX rather
// than competing with them.
export function startAmbientMusic() {
  const c = getContext();
  if (!c || musicStarted) return;
  musicStarted = true;

  const master = c.createGain();
  musicGain = master;
  master.gain.value = 0;
  master.connect(c.destination);
  master.gain.linearRampToValueAtTime(MUSIC_LEVEL, c.currentTime + 4);

  const chordFreqs = [55, 82.5, 110, 138.6]; // sparse open chord, low register
  chordFreqs.forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = i % 2 === 0 ? 'sine' : 'triangle';
    osc.frequency.value = freq;

    const noteGain = c.createGain();
    const baseLevel = 1 / chordFreqs.length;
    noteGain.gain.value = baseLevel;

    // Slow LFO on this note's own gain gives the pad a gentle "breathing"
    // swell instead of a static drone.
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.04 + i * 0.015;
    const lfoGain = c.createGain();
    lfoGain.gain.value = baseLevel * 0.5;
    lfo.connect(lfoGain).connect(noteGain.gain);
    lfo.start();

    osc.connect(noteGain).connect(master);
    osc.start();
  });
}

// Web Speech utterances play through a separate audio pipeline from Web
// Audio, so there's no way to directly boost TTS output above its own
// volume=1.0 ceiling — ducking the music out of the way while a character
// is speaking is what actually makes the voice read as more prominent.
export function duckMusic(active) {
  if (!musicGain || !ctx) return;
  const target = active ? MUSIC_LEVEL * 0.2 : MUSIC_LEVEL;
  musicGain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.35);
}

export function playDroneAlert() {
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  const gain = c.createGain();
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.4);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.5);
}
