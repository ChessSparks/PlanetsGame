const titleScreen = document.getElementById('title-screen');
const startBtn = document.getElementById('title-start-btn');
const continueBtn = document.getElementById('title-continue-btn');

// Shows the title screen and resolves once the player clicks Start or
// Continue — this is also the game's very first user gesture, which callers
// can rely on for anything that needs one (audio/speech unlocking).
// When hasProgress is true, a Continue button appears (resuming the saved
// phase) and Start is relabeled "New Game" (clears the save and starts
// fresh) instead of being the only option.
export function showTitleScreen({ hasProgress = false, onStart, onContinue }) {
  titleScreen.classList.remove('hidden');
  continueBtn.classList.toggle('hidden', !hasProgress);
  startBtn.textContent = hasProgress ? 'New Game' : 'Start';

  const cleanup = () => {
    startBtn.removeEventListener('click', startHandler);
    continueBtn.removeEventListener('click', continueHandler);
    titleScreen.classList.add('hidden');
  };
  const startHandler = () => {
    cleanup();
    onStart();
  };
  const continueHandler = () => {
    cleanup();
    onContinue();
  };
  startBtn.addEventListener('click', startHandler);
  continueBtn.addEventListener('click', continueHandler);
}
