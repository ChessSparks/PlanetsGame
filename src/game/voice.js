// Speaks objective updates aloud via the browser's built-in speech synthesis
// (no audio assets needed). Silently does nothing if unsupported. Must be
// triggered from a user gesture (e.g. a button click) for some browsers to
// allow it.
export function speak(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 0.8;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}
