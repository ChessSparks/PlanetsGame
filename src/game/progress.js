const STORAGE_KEY = 'planetsgame-progress';

// Wrapped in try/catch since localStorage can throw (private browsing,
// disabled storage, quota) — progress just silently fails to persist rather
// than crashing the game.
export function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.phase !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export function saveProgress(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function clearProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
