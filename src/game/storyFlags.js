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

export const storyFlags = {
  fourthClientFirstName: null,
};
