import { duckMusic } from './audio.js';
import { isTouchDevice } from './touchControls.js';

// Speaks lines aloud, preferring a recorded clip (see VOICE_CLIPS below) and
// falling back to the browser's built-in speech synthesis for any line that
// hasn't been recorded. Silently does nothing if neither is available. The
// speechSynthesis path must be triggered from a user gesture (e.g. a button
// click) for some browsers to allow it.
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

const VOICE_CLIP_DIR = '/audio/';

// Exact-match lookup from a line's literal text to its recorded clip —
// only lines that have actually been recorded are listed here; anything
// else still falls back to live speech synthesis below. Keys must match
// the announce()/speak() call sites in the scene files word-for-word.
const VOICE_CLIPS = {
  'This is Corthana, your ship\'s onboard AI — still online after the crash. Objective: find the key finder device nearby.':
    'davinci_this_is_corthana__your_ship_s_onboard_ai___still_o.mp3',
  'You were caught. Restarting the search — find the key finder first.':
    'davinci__you_were_caught__restarting_the_search___find_the.mp3',
  'Key finder online. Objective: find the 3 parts hidden across the planet.':
    'davinci_key_finder_online__objective__find_the_3_parts_hid.mp3',
  'Guardian drone deactivated — that part is safe now.':
    'SecondPart_davinci__guardian_drone_deactivated___that_part_is_safe_no.mp3',
  'All parts recovered. Objective: return to the spaceship and press E to repair it.':
    'davinci_all_parts_recovered__objective__return_to_the_spac.mp3',
  'I\'m not reading any life signs on this planet — nothing, except the plant life. Whatever happened here, it was a long time before we arrived.':
    'davinci_i_m_not_reading_any_life_signs_on_this_planet___no.mp3',
  'Spaceship repaired. Objective: find the small volcano nearby and solve its puzzle to secure fuel.':
    'davinci_spaceship_repaired__objective__find_the_small_volc.mp3',
  'Fuel secured. Return to the spaceship and press E to launch.':
    'davinci_fuel_secured__return_to_the_spaceship_and_press_e_.mp3',
  'Objective: find the map beacon.':
    'davinci_objective__find_the_map_beacon_.mp3',
  'You were caught. Regrouping at the landing site.':
    'davinci_you_were_caught__regrouping_at_the_landing_site_.mp3',
  'Objective: shut down the sentries at the control tower, then get to the ship.':
    'davinci__objective__shut_down_the_sentries_at_the_control_.mp3',
  'Spire location acquired. Objective: reach the spire.':
    'davinci_spire_location_acquired__objective__reach_located_.mp3',
  'Objective: find the console and solve it to map the crystal deposits.':
    'davinci_objective__find_the_console_and_solve_it_to_map_th.mp3',
  'Deposits located. Whatever these are for, it isn\'t the ship — she\'s already flightworthy. My guess is they\'re headed for power generation. That\'s almost never good news. Objective: collect the crystal deposits.':
    'davinci_deposits_located__whatever_these_are_for__it_isn_t.mp3',
  'All crystal deposits collected. Objective: return to the ship and press E.':
    'davinci__all_crystal_deposits_collected__objective__return.mp3',
  'Breaking atmosphere. Hold steady.':
    'davinci__breaking_atmosphere__hold_steady__.mp3',
};

let currentClip = null;

// Stops whatever recorded clip is currently playing (if any) and un-ducks
// the music — mirrors speechSynthesis.cancel()'s "stop mid-utterance"
// behavior below, since pausing an <audio> element doesn't fire 'ended'.
function stopClip() {
  if (!currentClip) return;
  currentClip.onended = null;
  currentClip.onerror = null;
  currentClip.pause();
  currentClip = null;
  duckMusic(false);
}

function playClip(url, onEnd) {
  const audio = new Audio(url);
  currentClip = audio;
  duckMusic(true);
  const finish = () => {
    if (currentClip === audio) currentClip = null;
    duckMusic(false);
    if (onEnd) onEnd();
  };
  audio.onended = finish;
  audio.onerror = finish; // missing/broken file — skip rather than hang
  audio.play().catch(finish); // blocked autoplay etc. — same fallback
}

// Settings-menu "Mute Voice" toggle — cancels anything mid-utterance so
// muting doesn't just silence future lines but leaves the current one
// finishing out loud.
export function setVoiceMuted(muted) {
  voiceMuted = muted;
  if (muted) {
    stopClip();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
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
  stopClip();

  const clip = VOICE_CLIPS[text];
  if (clip) {
    // Recorded audio works fine on mobile (unlike speechSynthesis below),
    // so this path runs on every device.
    playClip(VOICE_CLIP_DIR + clip, onEnd);
    return;
  }

  // No recorded line for this text — fall back to live speech synthesis.
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
