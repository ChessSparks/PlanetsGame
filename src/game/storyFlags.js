// Cross-scene story state. Scenes swap via dynamic import in main.js — the
// whole game runs in a single page load with no navigation/reload between
// phases — so plain module state persists exactly as long as it needs to
// (reset on an actual page refresh, same as everything else kept in memory).
//
// Smite Colony's aliens are chased down as a side activity, not a level
// gate: talking to the last one reveals this first name, which the buyer's
// list (buyersListScene.js) then substitutes into its 4th, otherwise-
// corrupted entry if it's been set.
export const FOURTH_CLIENT_FIRST_NAME = 'Voss';

// Same idea, one level later: Veyra Station's station-terminal word-guess
// puzzle reveals a middle name for the same still-mostly-corrupted 4th
// entry. Independent of the first-name flag above — either, both, or
// neither may be set depending on which of the two optional side
// activities the player actually did, in either order, so buyersListScene
// has to handle all four combinations gracefully.
export const FOURTH_CLIENT_MIDDLE_NAME = 'Elias';

export const storyFlags = {
  fourthClientFirstName: null,
  fourthClientMiddleName: null,
};
