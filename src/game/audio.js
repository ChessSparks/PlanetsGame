// Procedurally synthesized audio via the Web Audio API — the project has no
// sound asset files, so every chime/alert/theme/ambience below is generated
// tones/noise rather than loaded clips. Browsers block audio until a user
// gesture, so unlockAudio() must be called from a click handler (the title
// screen's Start button) before any of these will actually produce sound.
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

let sfxMuted = false;

export function setSfxMuted(muted) {
  sfxMuted = muted;
}

export function playPickupChime() {
  if (sfxMuted) return;
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

export function playDroneAlert() {
  if (sfxMuted) return;
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

// --- Cutscene/transition stings --------------------------------------------
// Short one-shot SFX for key non-gameplay beats, so those moments aren't
// silent besides whatever the ambient pad happens to be doing.

// A rising, filter-swept power-up sweep for engine ignition (ascent liftoff).
export function playIgnitionSting() {
  if (sfxMuted) return;
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.exponentialRampToValueAtTime(420, now + 1.4);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(300, now);
  filter.frequency.exponentialRampToValueAtTime(2200, now + 1.4);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + 1.6);
}

// A bright 3-note ascending arpeggio for reaching orbit.
export function playOrbitSting() {
  if (sfxMuted) return;
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = c.createGain();
    const start = now + i * 0.14;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.15, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}

// A soft two-note settling chime for arriving somewhere new — used partway
// through each travel cutscene, timed with the "Approaching X" caption.
export function playArrivalSting() {
  if (sfxMuted) return;
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  [392, 523.25].forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = c.createGain();
    const start = now + i * 0.25;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.13, start + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 1.5);
  });
}

// A low percussive thump (pitch-dropping sine) plus a short filtered-noise
// burst for ship touchdown at the end of a landing cutscene.
export function playLandingThud() {
  if (sfxMuted) return;
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(35, now + 0.35);
  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(0.001, now);
  oscGain.gain.linearRampToValueAtTime(0.3, now + 0.02);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  osc.connect(oscGain).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.45);

  const noiseSource = c.createBufferSource();
  noiseSource.buffer = getNoiseBuffer(c);
  const noiseFilter = c.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 500;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.001, now);
  noiseGain.gain.linearRampToValueAtTime(0.14, now + 0.015);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  noiseSource.connect(noiseFilter).connect(noiseGain).connect(c.destination);
  noiseSource.start(now);
  noiseSource.stop(now + 0.35);
}

// --- Ambient music: per-level themes, crossfaded ---------------------------
// A single shared output bus (musicGain) carries both the theme pad and the
// ambience loop below — one GainNode doubles as the "Music Volume" slider's
// target AND the duck-while-speaking target, so both layers move together
// without needing separate volume controls in the settings menu.
const MUSIC_LEVEL = 0.045;
let musicVolume = 0.7; // user-adjustable multiplier (0-1) via the settings menu
let musicDucked = false;
let musicGain = null;

function applyMusicLevel() {
  if (!musicGain || !ctx) return;
  const target = MUSIC_LEVEL * musicVolume * (musicDucked ? 0.2 : 1);
  musicGain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.35);
}

// Settings-menu volume slider.
export function setMusicVolume(volume) {
  musicVolume = Math.max(0, Math.min(1, volume));
  applyMusicLevel();
}

// Web Speech utterances play through a separate audio pipeline from Web
// Audio, so there's no way to directly boost TTS output above its own
// volume=1.0 ceiling — ducking music+ambience out of the way while a
// character is speaking is what actually makes the voice read as prominent.
export function duckMusic(active) {
  musicDucked = active;
  applyMusicLevel();
}

function ensureMusicBus() {
  const c = getContext();
  if (!c) return null;
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(c.destination);
    musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL * musicVolume, c.currentTime + 4);
  }
  return musicGain;
}

// Each level gets its own register/interval/tempo instead of one pad
// droning through the whole game: ground is the original calm open chord;
// ascent is brighter and breathes faster for momentum; moon sits higher and
// sparser with barely-moving LFOs for an empty, cold feel; client leans low
// with a near-semitone clash (92.5 vs 98 Hz) and a faster pulse for unease.
const MUSIC_THEMES = {
  ground: {
    freqs: [55, 82.5, 110, 138.6], types: ['sine', 'triangle', 'sine', 'triangle'], lfoBase: 0.04, lfoStep: 0.015, level: 1,
  },
  ascent: {
    freqs: [65.4, 98, 130.8, 164.8], types: ['triangle', 'sine', 'triangle', 'sine'], lfoBase: 0.09, lfoStep: 0.025, level: 1.1,
  },
  moon: {
    freqs: [98, 146.8, 220, 293.7], types: ['sine', 'sine', 'sine', 'sine'], lfoBase: 0.025, lfoStep: 0.008, level: 0.8,
  },
  client: {
    freqs: [49, 69.3, 92.5, 98], types: ['sawtooth', 'sine', 'triangle', 'sawtooth'], lfoBase: 0.12, lfoStep: 0.03, level: 1.15,
  },
};

let activeThemeName = null;
let activeThemeNodes = []; // { osc, lfo, gain } for the currently-playing theme

function fadeOutAndStop(nodes, c, fadeSeconds) {
  const now = c.currentTime;
  for (const n of nodes) {
    n.gain.gain.cancelScheduledValues(now);
    n.gain.gain.setValueAtTime(n.gain.gain.value, now);
    n.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
  }
  setTimeout(() => {
    for (const n of nodes) {
      for (const src of [n.osc, n.lfo, n.source]) {
        if (!src) continue;
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
      }
      n.gain.disconnect();
    }
  }, fadeSeconds * 1000 + 100);
}

// Crossfades from whatever's currently playing (including silence, on the
// very first call) into the named theme's chord. Idempotent when already on
// that theme, so every scene can safely call this on its own entry without
// worrying about whether a preceding travel cutscene already switched it.
export function playMusicTheme(theme) {
  if (activeThemeName === theme) return;
  const c = getContext();
  if (!c) return;
  const bus = ensureMusicBus();
  if (!bus) return;

  if (activeThemeNodes.length) fadeOutAndStop(activeThemeNodes, c, 2.5);

  const def = MUSIC_THEMES[theme] || MUSIC_THEMES.ground;
  const nodes = [];
  def.freqs.forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = def.types[i % def.types.length];
    osc.frequency.value = freq;

    const noteGain = c.createGain();
    const baseLevel = def.level / def.freqs.length;
    noteGain.gain.value = 0;

    // Slow LFO on this note's own gain gives the pad a gentle "breathing"
    // swell instead of a static drone — lfoBase/lfoStep set the tempo.
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = def.lfoBase + i * def.lfoStep;
    const lfoGain = c.createGain();
    lfoGain.gain.value = baseLevel * 0.5;
    lfo.connect(lfoGain).connect(noteGain.gain);
    lfo.start();

    osc.connect(noteGain).connect(bus);
    osc.start();
    noteGain.gain.linearRampToValueAtTime(baseLevel, c.currentTime + 3);

    nodes.push({ osc, lfo, gain: noteGain });
  });

  activeThemeNodes = nodes;
  activeThemeName = theme;
}

// Back-compat entry point — the ground level's intro ("Begin" click) is
// still the one place that first unlocks audio and kicks off music/ambience
// for the session.
export function startAmbientMusic() {
  playMusicTheme('ground');
  playAmbience('ground');
}

// --- Ambient environment loops (wind/hum, layered under the music) --------
// Filtered looping noise (plus a low hum oscillator for the industrial
// theme) through the same shared bus as the music, so "Music Volume" and
// voice-ducking control both layers together.
let noiseBuffer = null;
function getNoiseBuffer(c) {
  if (noiseBuffer) return noiseBuffer;
  const length = c.sampleRate * 2;
  noiseBuffer = c.createBuffer(1, length, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

const AMBIENCE_LEVEL = 0.15;
const AMBIENCE_THEMES = {
  // Breathing wind — a bandpass sweep drifting slowly over the noise floor.
  ground: {
    filterType: 'bandpass', freq: 500, q: 0.6, lfoRate: 0.06, lfoDepth: 250,
  },
  // Thin, quiet high-altitude/space hiss.
  ascent: {
    filterType: 'lowpass', freq: 220, q: 0.5, lfoRate: 0.03, lfoDepth: 60,
  },
  // Thin, cold, near-silent static — the moon should feel emptiest of all.
  moon: {
    filterType: 'highpass', freq: 2400, q: 0.4, lfoRate: 0.02, lfoDepth: 300,
  },
  // Filtered noise plus a steady low hum for an industrial-machinery feel.
  client: {
    filterType: 'lowpass', freq: 900, q: 1.2, lfoRate: 0.15, lfoDepth: 150, hum: 60,
  },
};

let activeAmbienceName = null;
let activeAmbienceNodes = []; // { source, gain, lfo }

export function playAmbience(theme) {
  if (activeAmbienceName === theme) return;
  const c = getContext();
  if (!c) return;
  const bus = ensureMusicBus();
  if (!bus) return;

  if (activeAmbienceNodes.length) fadeOutAndStop(activeAmbienceNodes, c, 2);

  const def = AMBIENCE_THEMES[theme] || AMBIENCE_THEMES.ground;
  const nodes = [];

  const noiseSource = c.createBufferSource();
  noiseSource.buffer = getNoiseBuffer(c);
  noiseSource.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = def.filterType;
  filter.frequency.value = def.freq;
  filter.Q.value = def.q;
  const noiseGain = c.createGain();
  noiseGain.gain.value = 0;

  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = def.lfoRate;
  const lfoGain = c.createGain();
  lfoGain.gain.value = def.lfoDepth;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  noiseSource.connect(filter).connect(noiseGain).connect(bus);
  noiseSource.start();
  noiseGain.gain.linearRampToValueAtTime(AMBIENCE_LEVEL, c.currentTime + 3);
  nodes.push({ source: noiseSource, gain: noiseGain, lfo });

  if (def.hum) {
    const humOsc = c.createOscillator();
    humOsc.type = 'sawtooth';
    humOsc.frequency.value = def.hum;
    const humGain = c.createGain();
    humGain.gain.value = 0;
    humOsc.connect(humGain).connect(bus);
    humOsc.start();
    humGain.gain.linearRampToValueAtTime(AMBIENCE_LEVEL * 0.8, c.currentTime + 3);
    nodes.push({ source: humOsc, gain: humGain, lfo: null });
  }

  activeAmbienceNodes = nodes;
  activeAmbienceName = theme;
}
