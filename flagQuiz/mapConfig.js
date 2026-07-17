/**
 * Per-deck contour-map configuration for flagQuiz.
 *
 * Every deck mounts the same shared asset (`worldMap.svg`) and, except for the
 * whole-world views, crops the viewBox to the deck's own country codes. The
 * page wiring reads this table in `mountMap()`; a deck absent from it silently
 * mounts no map at all (`if (!QUIZ_MAP_CONFIG[key]) return`).
 *
 * That silence is why this lives here rather than inside `startGame()`, where
 * it was born: it was unreachable by tests, so when Feature V added the `weird`
 * deck the deck simply had no map and nothing said so. `mapConfig.test.js` now
 * pins that every VARIANTS key has an entry, that every `cropExcludes` code is
 * real, and that no exclude is dead.
 *
 * Fields:
 *   - `url`    the SVG asset to mount.
 *   - `crop`   crop the viewBox to the union of the deck's country bboxes?
 *              False only for world views, where the asset's natural viewBox
 *              is already right.
 *   - `cropExcludes`  codes dropped from the **bbox crop computation only**.
 *              The country still renders and is still quizzed; it just doesn't
 *              pull the viewBox toward its own bbox. Two reasons a code lands
 *              here, and neither is about the quiz pool:
 *                1. It spans the antimeridian, so its `<g>` bbox effectively
 *                   wraps the whole map (US's Aleutians, Fiji, Kiribati).
 *                2. The SVG asset bundles a country's overseas territories
 *                   into the metropole's `<g>` (fr + French Guiana, dk +
 *                   Greenland, es + Canaries), so its bbox spans oceans. This
 *                   is a property of how the asset is grouped, NOT of what the
 *                   deck contains — France's `<g>` holds French Guiana whether
 *                   or not French Guiana is a quiz answer.
 *   - `cropPad`  extends the crop bounds in SVG units after the bbox union is
 *              computed. Compensates for the excludes above: NA drops `us`
 *              from the bbox math but pads the west edge by 200 so Alaska's
 *              main body comes back into view.
 *
 * @typedef {{
 *   url: string,
 *   crop: boolean,
 *   cropExcludes?: string[],
 *   cropPad?: { left?: number, right?: number, top?: number, bottom?: number },
 * }} QuizMapConfig
 *
 * @type {Record<string, QuizMapConfig>}
 */
export const QUIZ_MAP_CONFIG = {
  // "All countries" — the whole-world view. No crop; the asset's
  // natural viewBox already covers everything. Microstates scope
  // is the full pool so every tiny country worldwide gets a ring.
  countries:       { url: './worldMap.svg',  crop: false },
  // Europe: several European countries' <g> on the world map bundle
  // their overseas territories with the metropole (fr+French Guiana,
  // dk+Greenland, es+Canaries, nl/pt/gb/no their Atlantic/Caribbean
  // bits), so their bbox spans oceans — dropping them from the crop
  // math keeps the viewBox on metropolitan Europe (same trick NA uses
  // for the US). They still render + are quizzed; their mainland sits
  // inside the frame the other European countries anchor. cropPad
  // gives Iberia + the British Isles a little western breathing room.
  europe:          { url: './worldMap.svg',  crop: true,
                     cropExcludes: ['fr', 'es', 'pt', 'nl', 'gb', 'dk', 'no', 'ru'],
                     cropPad: { left: 30, bottom: 15 } },
  asia:            { url: './worldMap.svg',  crop: true  },
  africa:          { url: './worldMap.svg',  crop: true  },
  'north-america': { url: './worldMap.svg',  crop: true,  cropExcludes: ['us'], cropPad: { left: 200 } },
  'south-america': { url: './worldMap.svg',  crop: true  },
  // Fiji and Kiribati both span the antimeridian — including them
  // would blow the crop out the same way US did for NA. Australia +
  // NZ + the central-Pacific island chains still anchor a sensible
  // Oceania view without them.
  oceania:         { url: './worldMap.svg',  crop: true,  cropExcludes: ['fj', 'ki'] },
  // Weird flags: the world view, uncropped. The pool is 54 territories
  // scattered across every ocean, so there is no meaningful bbox to crop
  // to — the union of Greenland, Hong Kong and Pitcairn IS the world.
  // This deck needs the map most: "which flag is Montserrat?" is a question
  // about a place the player has very likely never located.
  weird:           { url: './worldMap.svg',  crop: false },
  // Outlines: the world view, uncropped — 157 countries spread over every
  // continent, so there's no bbox worth cropping to. The map is NOT redundant
  // with the question here: the choices say what a country's shape looks like,
  // the map says where on earth it sits. Different facts.
  outlines:        { url: './worldMap.svg',  crop: false },
};
