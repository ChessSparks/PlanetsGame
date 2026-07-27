const titleScreen = document.getElementById('title-screen');
const startBtn = document.getElementById('title-start-btn');

// Shows the title screen and resolves once the player clicks Start — this
// is also the game's very first user gesture, which callers can rely on for
// anything that needs one (audio/speech unlocking).
export function showTitleScreen(onStart) {
  titleScreen.classList.remove('hidden');
  const handler = () => {
    startBtn.removeEventListener('click', handler);
    titleScreen.classList.add('hidden');
    onStart();
  };
  startBtn.addEventListener('click', handler);
}
