// Procedurally synthesized SFX via the Web Audio API — the project has no
// sound asset files, so footsteps/chime/alert are generated tones/noise
// rather than loaded clips. Browsers block audio until a user gesture, so
// unlockAudio() must be called from a click handler (the tutorial overlay's
// "Begin" button) before any of these will actually produce sound.
let ctx = null;
let noiseBuffer = null;

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

function getNoiseBuffer(c) {
  if (!noiseBuffer) {
    const length = Math.floor(c.sampleRate * 0.3);
    noiseBuffer = c.createBuffer(1, length, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

let stepIndex = 0;

// Two layers per step — a filtered noise transient swept downward (a
// dustier "boot crunching regolith" texture instead of a flat click) plus a
// low sine thump underneath for a sense of weight — alternating slightly by
// step parity so it doesn't sound like the exact same sample on repeat.
export function playFootstep(intensity = 1) {
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  stepIndex += 1;
  const variant = stepIndex % 2 === 0 ? 1 : -1;

  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  const baseFreq = 1300 + variant * 150 + Math.random() * 250;
  filter.frequency.setValueAtTime(baseFreq, now);
  filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.3, now + 0.1);
  const noiseGain = c.createGain();
  const noiseVol = 0.12 * intensity;
  noiseGain.gain.setValueAtTime(noiseVol, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  src.connect(filter).connect(noiseGain).connect(c.destination);
  src.start(now);
  src.stop(now + 0.13);

  const thump = c.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(115 + variant * 10, now);
  thump.frequency.exponentialRampToValueAtTime(50, now + 0.09);
  const thumpGain = c.createGain();
  const thumpVol = 0.11 * intensity;
  thumpGain.gain.setValueAtTime(thumpVol, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  thump.connect(thumpGain).connect(c.destination);
  thump.start(now);
  thump.stop(now + 0.12);
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
