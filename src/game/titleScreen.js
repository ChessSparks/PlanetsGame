const titleScreen = document.getElementById('title-screen');
const startBtn = document.getElementById('title-start-btn');
const menuBtn = document.getElementById('title-menu-btn');
const levelMenu = document.getElementById('title-level-menu');
const levelListEl = document.getElementById('title-level-list');
const levelMenuCloseBtn = document.getElementById('title-level-menu-close');

// Shows the title screen and resolves once the player clicks Start —
// this is also the game's very first user gesture, which callers can
// rely on for anything that needs one (audio/speech unlocking).
//
// `levels` (optional) populates the ☰ button's level-select panel — a
// player-facing replacement for what used to be a dev-only jump panel:
// each entry's onSelect() fires straight away (no travel cutscene, same
// as the old dev buttons), while normal play via the Start button keeps
// going through every level in order with its cutscenes intact. Both the
// button and panel live inside #title-screen itself, so they fade out
// with it the same moment gameplay actually starts — nothing lingers
// on-screen once you're playing.
export function showTitleScreen({ onStart, levels = [] }) {
  titleScreen.classList.remove('hidden');
  levelMenu.classList.add('hidden');

  const cleanup = () => {
    startBtn.removeEventListener('click', startHandler);
    menuBtn.removeEventListener('click', menuToggleHandler);
    levelMenuCloseBtn.removeEventListener('click', menuCloseHandler);
    levelListEl.innerHTML = '';
    titleScreen.classList.add('hidden');
  };
  const startHandler = () => {
    cleanup();
    onStart();
  };
  const menuToggleHandler = () => {
    levelMenu.classList.toggle('hidden');
  };
  const menuCloseHandler = () => {
    levelMenu.classList.add('hidden');
  };

  startBtn.addEventListener('click', startHandler);
  menuBtn.addEventListener('click', menuToggleHandler);
  levelMenuCloseBtn.addEventListener('click', menuCloseHandler);

  levelListEl.innerHTML = '';
  for (const level of levels) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'title-level-btn';
    btn.textContent = level.label;
    btn.addEventListener('click', () => {
      cleanup();
      level.onSelect();
    });
    levelListEl.appendChild(btn);
  }
}
