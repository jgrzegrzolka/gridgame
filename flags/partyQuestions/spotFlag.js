import { emptyFilters, matchesFilters } from '../flagsFilter.js';
import { serializeFilter, parseFilterString, pillLabel, filterTitle } from '../findFlag.js';

/**
 * The "spot the flag" question: the criteria are SHOWN, and exactly one of the
 * four flags satisfies all of them.
 *
 *   has red  ·  no green  ·  has a star or moon
 *
 * Every other question in the show rewards knowing something — which flag is
 * Peru, which outline is Chile, which country grows the most coffee. This one
 * rewards *looking*, and nothing else: the rule is on screen, so a player who
 * knows no flags at all can win it against someone who knows them all. That is
 * the point of the mode, not a side effect.
 *
 * **Why the answer can't be ambiguous.** An "odd one out" (three share a hidden
 * trait, spot the intruder) has to prove no *competing* rule picks a different
 * flag, which is a hard search and a judgement call. Stating the rule deletes
 * that whole problem: there is nothing to infer, so validity reduces to "exactly
 * one of the four satisfies the spec", which is a filter and a length check.
 *
 * **Every clause earns its place.** Each of the three wrong flags fails exactly
 * one clause, and no two fail the same one. So each clause is the sole reason
 * some tile dies: check one and you eliminate exactly one flag, and none of the
 * three is decorative. A puzzle where two distractors died to the same clause
 * would leave another clause untested and be softer than it looks.
 *
 * Almost all the machinery is borrowed rather than built. A spec IS a findFlag
 * `Filters` — same predicate (`matchesFilters`), same wire format
 * (`serializeFilter` / `parseFilterString`, already round-trip tested), same
 * localized pill labels including the Polish genitive for negated clauses. The
 * only new logic here is choosing a spec and assembling the quartet.
 *
 * Satisfies the question contract in `PARTY.md`: `generate(pool)` builds the
 * question, `isCorrect(question, choice)` judges a buzz, and the room stays
 * question-agnostic.
 *
 * **The answer is derivable client-side**, since the client holds the same
 * country tags and the spec is on screen. That is the same trade flag-pick
 * already makes (its prompt names the target outright): a friends-in-a-room
 * party game is not a place anyone is opening devtools to win a round.
 */

/** @typedef {import('../group.js').Country} Country */
/** @typedef {import('../flagsFilter.js').Filters} Filters */
/** @typedef {{ group: 'color' | 'motif' | 'country', value: string, sign: 'include' | 'exclude' }} Clause
 *  A `country` clause is always `sign: 'exclude'` and its `value` is a country code
 *  ({@link COUNTRY_DECOYS}); it is NOT a Filters property, so it round-trips through
 *  the prompt and is matched by code rather than through `matchesFilters`. */
/** @typedef {{ prompt: string, options: string[], answer: string }} Question */

/**
 * Colours a clause may name. Matched against `primaryColors` (see
 * {@link COLOR_FIELD}), so this is the palette that reads across a room.
 * @type {string[]}
 */
export const SPOT_COLORS = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'orange'];

/**
 * Colours that read as each other on a thumbnail. When a spec turns on one of a
 * pair, the other is kept off every tile (see {@link buildPuzzle}) so no round
 * comes down to "was that yellow or orange" rather than to the flags.
 *
 * Yellow/orange is the only such pair the tag vocabulary actually produces. Red +
 * green is a different problem (colour blindness, not shade) and gets a stricter
 * rule: they may never be co-clauses at all ({@link randomSpec}), because there
 * the discrimination itself is what some players cannot make.
 * @type {Record<string, string>}
 */
export const CONFUSABLE_COLOR = { yellow: 'orange', orange: 'yellow' };

/**
 * Motifs a clause may name — deliberately NOT the full motif vocabulary.
 *
 * `coat-of-arms` is out because it is the contested tag (whether Oman's emblem
 * counts has been argued twice) and a party is the worst possible place to
 * litigate one. `weapon` is out because 7 of its 13 flags carry it inside a
 * crest, where nobody can see it. `eu-member` is out because it is political,
 * not visual, and this mode is only ever about what is on the cloth.
 * @type {string[]}
 */
export const SPOT_MOTIFS = ['cross', 'star-or-moon', 'animal', 'bird', 'union-jack'];

/**
 * Well-known flags that may appear as a "rule this country out" clause: the spec
 * says the answer is NOT this country, and the country itself sits as a tile that
 * matches every other visible criterion. You eliminate the other wrong tiles by
 * LOOKING, then have to KNOW this flag to reject the last one — the deliberate
 * knowledge nudge in an otherwise pure-looking mode, and a chance to learn a
 * confusable pair (France vs the Netherlands, Indonesia vs Poland, Australia vs
 * New Zealand).
 *
 * All must be sovereign, in the pool, and {@link isSpottable} (no coat of arms) —
 * Mexico, Egypt, Saudi Arabia and Kenya are famous but excluded for that reason,
 * their charges hiding in a crest. Kept as codes (edit freely); pinned by a test.
 * @type {string[]}
 */
export const COUNTRY_DECOYS = [
  // Europe
  'fr', 'nl', 'pl', 'it', 'de', 'ie', 'be', 'ua', 'ro', 'gr', 'ch', 'se', 'gb',
  // Americas
  'us', 'ca', 'br', 'ar', 'cl', 'cu', 'jm',
  // Asia
  'jp', 'cn', 'in', 'kr', 'vn', 'th', 'tr', 'id', 'il',
  // Africa
  'za', 'ng', 'ma', 'gh', 'et',
  // Oceania
  'au', 'nz',
];
const COUNTRY_DECOY_SET = new Set(COUNTRY_DECOYS);

/** How often a puzzle is forced to carry a country rule-out clause, best effort:
 *  a forced attempt that can't build a valid country puzzle falls back to a normal
 *  one, so the DEALT share sits a little under this. */
export const FORCE_COUNTRY_RATE = 0.5;

/** Three clauses, four tiles: clauses = tiles - 1, so every clause kills exactly
 *  one distractor. Raising this raises the tile count with it. */
export const SPOT_CLAUSES = 3;

/**
 * Colours are matched against `primaryColors`, never the full palette.
 *
 * The full palette includes anything visible in a coat of arms, which is fine
 * for findFlag's browse UI where you can zoom in — and wrong here, where the
 * player has a thumbnail and a few seconds. It is the same reason the daily
 * generator uses this field: "European flags with green" must not surface a
 * flag whose only green is a leaf in the crest.
 */
const COLOR_FIELD = /** @type {const} */ ({ colorField: 'primaryColors' });

/** How many specs to try before giving up. Roughly half of all random specs
 *  yield a valid puzzle (measured over 20k trials), so exhausting this many is
 *  a data problem — a shrunken pool, a vocabulary edit — not bad luck. */
const MAX_ATTEMPTS = 200;

export const id = 'spotFlag';

/**
 * Flags this mode will not use — for tiles OR answers.
 *
 * A flag whose emblem is a coat of arms carries most of its motifs *inside* the
 * crest, where they are invisible at tile size. The tag data is correct (Moldova
 * really does have an animal, a bird and a cross on it) but it records what is
 * TRUE, not what is VISIBLE, and this mode can only ask about the second. Ten of
 * the twenty-nine cross flags are crest-bound, so leaving them in means regularly
 * asking players to spot something they cannot see.
 *
 * The blunt fix costs ~34 countries. The precise fix — a per-flag "this motif is
 * prominent" annotation — is data work that should wait until the mode has proved
 * itself worth it.
 *
 * @param {Country} c
 * @returns {boolean}
 */
export function isSpottable(c) {
  return !(c.motifs || []).includes('coat-of-arms');
}

/**
 * A colour this country's own data flags as arguable (`ambiguousColors`) must
 * never appear as a clause about it: the player would be comparing our judgement
 * against their eyes on precisely the case where we already know reasonable
 * people disagree.
 *
 * @param {Country} c
 * @param {Clause[]} clauses
 * @returns {boolean}
 */
function ambiguousUnder(c, clauses) {
  const amb = c.ambiguousColors || [];
  return amb.some((a) => clauses.some((cl) => cl.group === 'color' && cl.value === a));
}

/**
 * Build the `Filters` for a clause list (or a single clause, for per-clause
 * tests). Pure translation: our clause list is just a flatter view of a Filters.
 *
 * @param {Clause[]} clauses
 * @returns {Filters}
 */
export function filtersFor(clauses) {
  const f = emptyFilters();
  // Cast at this single line rather than widening the return type: `Filters` is
  // a fixed-shape record, so indexing it by a variable group name is what needs
  // loosening, not what every caller gets back. Returning `any` erased checking
  // on `matchesFilters`, `serializeFilter` and the page's title call alike, which
  // is the opposite of what flags/** being on the strict config is for.
  //
  // Country clauses are skipped: they are not a Filters property (there is no
  // country-identity filter), so they are matched by code in {@link matchesSpec}
  // and carried on the wire as their own `not:<code>` token. filtersFor still
  // covers the colour/motif half, which is what `matchesFilters` and the criteria
  // marks consume.
  for (const cl of clauses) {
    if (cl.group === 'country') continue;
    /** @type {any} */ (f)[cl.group][cl.sign].add(cl.value);
  }
  return f;
}

/**
 * Whether a country satisfies EVERY clause, country clauses included. `filtersFor`
 * only covers colour/motif, so a bare `matchesFilters(c, filtersFor(clauses))`
 * silently ignores a "not France" clause and would call France a match — the exact
 * thing the country round is about. This is the full check the generator and tests
 * must use once a spec can carry a country.
 *
 * @param {Country} c
 * @param {Clause[]} clauses
 * @returns {boolean}
 */
export function matchesSpec(c, clauses) {
  for (const cl of clauses) {
    if (cl.group === 'country') {
      const isThat = c.code === cl.value;
      if (cl.sign === 'exclude' ? isThat : !isThat) return false;
    } else if (!matchesFilters(c, filtersFor([cl]), COLOR_FIELD)) {
      return false;
    }
  }
  return true;
}

/**
 * The clause a country fails, or null when it satisfies the whole spec. Used by
 * the reveal to say WHY each wrong flag was wrong ("has green"), which is what
 * stops the mode feeling arbitrary — you learn what to look at next time.
 *
 * Returns the first failure; a well-formed puzzle's distractors each fail
 * exactly one, so "first" and "only" coincide by construction.
 *
 * @param {Country} c
 * @param {Clause[]} clauses
 * @returns {Clause | null}
 */
export function failingClause(c, clauses) {
  for (const cl of clauses) {
    if (!matchesSpec(c, [cl])) return cl;
  }
  return null;
}

/**
 * Recover the clause list from a question's prompt (the serialized spec). The
 * client needs this to render the criteria and to label the reveal.
 *
 * Returns null when the spec names anything this build doesn't know — a newer
 * server having added a colour or motif to the vocabulary. That is a version
 * skew, and it routes to the same one-shot reload as an unknown question id
 * rather than rendering a spec with a clause silently missing, which would show
 * the room a puzzle whose answer looks wrong.
 *
 * @param {string} prompt
 * @returns {Clause[] | null}
 */
export function clausesFromPrompt(prompt) {
  const f = parseFilterString(prompt);
  /** @type {Clause[]} */
  const out = [];
  // Colour / motif half (everything parseFilterString understands).
  if (f) {
    for (const group of /** @type {const} */ (['color', 'motif'])) {
      for (const sign of /** @type {const} */ (['include', 'exclude'])) {
        for (const value of f[group][sign]) {
          const known = group === 'color' ? SPOT_COLORS : SPOT_MOTIFS;
          if (!known.includes(value)) return null;
          out.push({ group, value, sign });
        }
      }
    }
  }
  // Country rule-out clauses ride as their own `not:<code>` tokens — invisible to
  // parseFilterString, which has no country Filters group, so they are pulled from
  // the raw prompt here. A code outside the decoy set means a server newer than
  // this build (it added a decoy we don't know), the same skew signal as an unknown
  // colour, and gets the same null → reload. This is ALSO what protects an OLD
  // client: without this loop it never counts the country clause, so a country
  // round's 2 colour/motif clauses fail the SPOT_CLAUSES count below and reload.
  for (const rawTok of prompt.split(',')) {
    const tok = rawTok.trim();
    if (!tok.startsWith('not:')) continue;
    const code = tok.slice(4);
    if (!code) continue;
    if (!COUNTRY_DECOY_SET.has(code)) return null;
    out.push({ group: 'country', value: code, sign: 'exclude' });
  }
  if (out.length !== SPOT_CLAUSES) return null;
  // Reject anything we cannot faithfully REPRESENT, not merely anything we cannot
  // label. The colour/motif loop walks only those two groups, so a spec naming a
  // group this mode does not use — a continent, a statehood, a colour count — would
  // have that clause silently dropped; with the remaining clauses still hitting the
  // count, the room would be shown a spec short a clause, and the tiles that fail
  // the missing one look like they pass. Round-tripping the colour/motif half
  // catches it whatever the extra group is. (Country tokens are excluded from both
  // sides of the comparison, so they never trip it.)
  const cm = out.filter((c) => c.group !== 'country');
  return serializeFilter(filtersFor(cm)) === serializeFilter(f || emptyFilters()) ? out : null;
}

/**
 * Serialize a spec to the prompt string: the colour/motif half through findFlag's
 * `serializeFilter` (so those clauses share one wire format with the rest of the
 * site), plus a `not:<code>` token per country clause. {@link clausesFromPrompt}
 * is the inverse.
 *
 * @param {Clause[]} clauses
 * @returns {string}
 */
export function serializeSpec(clauses) {
  const cm = clauses.filter((c) => c.group !== 'country');
  const tokens = [serializeFilter(filtersFor(cm))];
  for (const c of clauses) if (c.group === 'country') tokens.push(`not:${c.value}`);
  return tokens.filter(Boolean).join(',');
}

/**
 * @param {number} n
 * @param {() => number} rng
 * @returns {number}
 */
const rnd = (n, rng) => Math.floor(rng() * n);
/**
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T}
 */
const pick = (arr, rng) => arr[rnd(arr.length, rng)];

/**
 * Colours the spec keeps off every tile because they read as a clause colour on a
 * thumbnail (yellow <-> orange). At most one colour, since neither builder ever
 * puts both of a confusable pair in a spec.
 *
 * @param {Clause[]} clauses
 * @returns {Set<string>}
 */
function confusableBans(clauses) {
  const banned = new Set();
  for (const cl of clauses) {
    if (cl.group === 'color' && CONFUSABLE_COLOR[cl.value]) banned.add(CONFUSABLE_COLOR[cl.value]);
  }
  return banned;
}

/**
 * A random spec, or null when the draw broke one of the two composition rules.
 *
 * **At least one motif clause.** A spec of three colours can come down to
 * telling red from green, which roughly one man in twelve cannot do. A motif
 * clause guarantees every puzzle has at least one non-colour way in.
 *
 * **Never red and green in the same spec**, for the same reason from the other
 * direction: those two as the discriminating pair is the classic trap.
 *
 * @param {() => number} rng
 * @returns {Clause[] | null}
 */
export function randomSpec(rng) {
  const motifCount = 1 + rnd(2, rng);
  /** @type {Clause[]} */
  const clauses = [];
  const usedMotifs = new Set();
  const usedColors = new Set();
  for (let i = 0; i < motifCount; i += 1) {
    /** @type {string} */ let v;
    do { v = pick(SPOT_MOTIFS, rng); } while (usedMotifs.has(v));
    usedMotifs.add(v);
    clauses.push({ group: 'motif', value: v, sign: rng() < 0.35 ? 'exclude' : 'include' });
  }
  while (clauses.length < SPOT_CLAUSES) {
    /** @type {string} */ let v;
    do { v = pick(SPOT_COLORS, rng); } while (usedColors.has(v));
    usedColors.add(v);
    clauses.push({ group: 'color', value: v, sign: rng() < 0.45 ? 'exclude' : 'include' });
  }
  if (usedColors.has('red') && usedColors.has('green')) return null;
  // Yellow and orange as the two colour clauses IS the misclassification trap, and
  // it also can't be fixed at the tile level (the spec would demand a colour it
  // also has to ban). Reject it here, the same way as red + green above.
  if (usedColors.has('yellow') && usedColors.has('orange')) return null;
  return clauses;
}

/**
 * One attempt at a puzzle: a spec, an answer satisfying all of it, and one
 * distractor per clause failing only that clause.
 *
 * @param {Country[]} pool
 * @param {() => number} rng
 * @param {Set<string>} [exclude] answer codes already used this game
 * @returns {{ clauses: Clause[], answer: Country, distractors: Country[] } | null}
 */
export function buildPuzzle(pool, rng, exclude) {
  const clauses = randomSpec(rng);
  if (!clauses) return null;
  // Yellow and orange read alike at tile size; if the spec names one, keep the
  // other off every tile (answer and distractors alike) so the round never turns
  // on telling the two apart. Checked against the visible `primaryColors` — the
  // same field colour includes match — because an orange buried in a crest is too
  // small to be mistaken for yellow. `randomSpec` guarantees the spec never names
  // both, so `banned` holds at most one colour and can't contradict the spec.
  const banned = confusableBans(clauses);
  const eligible = pool.filter((c) => isSpottable(c) && !ambiguousUnder(c, clauses)
    && !c.primaryColors.some((col) => banned.has(col)));

  const all = filtersFor(clauses);
  let answers = eligible.filter((c) => matchesFilters(c, all, COLOR_FIELD));
  if (exclude && exclude.size) {
    const fresh = answers.filter((c) => !exclude.has(c.code));
    // Repeating a country is better than failing to deal a question, so the
    // no-repeat wish yields when it would empty the candidates -- same rule
    // flag-pick applies to its own pool.
    if (fresh.length) answers = fresh;
  }
  if (!answers.length) return null;

  /** @type {Country[][]} */
  const perClause = clauses.map((_, i) => {
    const others = filtersFor(clauses.filter((_, j) => j !== i));
    const only = filtersFor([clauses[i]]);
    return eligible.filter((c) =>
      matchesFilters(c, others, COLOR_FIELD) && !matchesFilters(c, only, COLOR_FIELD));
  });
  if (perClause.some((d) => !d.length)) return null;

  const answer = pick(answers, rng);
  const used = new Set([answer.code]);
  /** @type {Country[]} */
  const distractors = [];
  for (const candidates of perClause) {
    const free = candidates.filter((c) => !used.has(c.code));
    if (!free.length) return null;
    const d = pick(free, rng);
    used.add(d.code);
    distractors.push(d);
  }
  return { clauses, answer, distractors };
}

/**
 * One attempt at a COUNTRY puzzle: a two-clause colour/motif spec that a chosen
 * decoy country satisfies, plus a `not <that country>` clause. The decoy sits as a
 * tile that clears every VISIBLE criterion, so it fails only the country clause —
 * you eliminate the other two wrong tiles by looking, then have to KNOW the flag to
 * reject the decoy. Its two clauses are derived FROM the decoy (a colour it has or
 * lacks, a motif it has or lacks), which is exactly what makes it satisfy them.
 *
 * @param {Country[]} pool
 * @param {() => number} rng
 * @param {Set<string>} [exclude] answer codes already used this game
 * @returns {{ clauses: Clause[], answer: Country, distractors: Country[] } | null}
 */
export function buildCountryPuzzle(pool, rng, exclude) {
  const decoys = pool.filter((c) => COUNTRY_DECOY_SET.has(c.code) && isSpottable(c));
  if (!decoys.length) return null;
  const x = pick(decoys, rng);

  // A motif clause the decoy satisfies: include what it has, exclude what it lacks.
  const motif = pick(SPOT_MOTIFS, rng);
  const motifSign = (x.motifs || []).includes(motif) ? 'include' : 'exclude';
  // A colour clause the decoy satisfies. Includes match the VISIBLE `primaryColors`
  // but excludes read the FULL palette (an "not X" is false if X hides in a crest),
  // so a colour the decoy carries only in a crest fits neither sign — skip it.
  const color = pick(SPOT_COLORS, rng);
  /** @type {'include' | 'exclude'} */
  let colorSign;
  if (x.primaryColors.includes(color)) colorSign = 'include';
  else if (!(x.colors || []).includes(color)) colorSign = 'exclude';
  else return null;

  /** @type {Clause[]} */
  const clauses = [
    { group: 'motif', value: motif, sign: motifSign },
    { group: 'color', value: color, sign: colorSign },
    { group: 'country', value: x.code, sign: 'exclude' },
  ];
  // The decoy has to be a clean tile about its own colour, same rule as any answer.
  if (ambiguousUnder(x, clauses)) return null;

  const banned = confusableBans(clauses);
  const eligible = pool.filter((c) => isSpottable(c) && !ambiguousUnder(c, clauses)
    && !c.primaryColors.some((col) => banned.has(col)));
  // The decoy itself must survive the tile ban (e.g. a "not yellow" clause bans
  // orange, and India / Ireland carry orange) — without it there is no country tile.
  if (!eligible.some((c) => c.code === x.code)) return null;

  const cm = /** @type {Clause[]} */ (clauses.slice(0, 2));
  // A tile that fails ONLY clause `i`: it clears the other colour/motif clause and
  // is not the decoy (so it clears "not x"), but fails clause `i`.
  const failsOnly = (/** @type {number} */ i) => eligible.filter((c) => c.code !== x.code
    && matchesSpec(c, cm.filter((_, j) => j !== i)) && !matchesSpec(c, [cm[i]]));

  let answers = eligible.filter((c) => c.code !== x.code && matchesSpec(c, cm));
  if (exclude && exclude.size) {
    const fresh = answers.filter((c) => !exclude.has(c.code));
    if (fresh.length) answers = fresh;
  }
  if (!answers.length) return null;

  const motifDistractors = failsOnly(0);
  const colorDistractors = failsOnly(1);
  if (!motifDistractors.length || !colorDistractors.length) return null;

  const answer = pick(answers, rng);
  const used = new Set([answer.code, x.code]);
  // The country clause's distractor IS the decoy — the only flag that fails "not x".
  /** @type {Country[]} */
  const distractors = [x];
  for (const candidates of [motifDistractors, colorDistractors]) {
    const free = candidates.filter((c) => !used.has(c.code));
    if (!free.length) return null;
    const d = pick(free, rng);
    used.add(d.code);
    distractors.push(d);
  }
  return { clauses, answer, distractors };
}

/**
 * @param {Country[]} pool
 * @param {Set<string>} [exclude] answer codes already used this game
 * @param {() => number} [rng] injectable for tests
 * @returns {Question}
 */
export function generate(pool, exclude, rng = Math.random) {
  // The coin flip is per DEAL, not per attempt: re-rolling each attempt would bias
  // the dealt share toward whichever builder succeeds more often (country puzzles
  // do), pushing the country rate well above FORCE_COUNTRY_RATE. Decide once, try
  // that builder to exhaustion, and only fall back to a normal puzzle if a forced
  // country deal genuinely can't be built (a data problem), so a round is always
  // dealt.
  if (rng() < FORCE_COUNTRY_RATE) {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const p = buildCountryPuzzle(pool, rng, exclude);
      if (p) return toQuestion(p, rng);
    }
  }
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const p = buildPuzzle(pool, rng, exclude);
    if (p) return toQuestion(p, rng);
  }
  throw new Error(`spotFlag: no puzzle after ${MAX_ATTEMPTS} attempts`);
}

/**
 * Shuffle a built puzzle's options and serialize its spec into the wire Question.
 *
 * @param {{ clauses: Clause[], answer: Country, distractors: Country[] }} p
 * @param {() => number} rng
 * @returns {Question}
 */
function toQuestion(p, rng) {
  const options = [p.answer, ...p.distractors].map((c) => c.code);
  // Fisher-Yates: the answer is built first, so an unshuffled list would put it
  // at index 0 every single time.
  for (let j = options.length - 1; j > 0; j -= 1) {
    const k = rnd(j + 1, rng);
    [options[j], options[k]] = [options[k], options[j]];
  }
  return { prompt: serializeSpec(p.clauses), options, answer: p.answer.code };
}

/**
 * The reveal's label for a flag that missed the spec: what this flag DID, stated
 * as the criterion it broke. "not green" in the spec becomes **"green"** on the
 * offending tile, and "has a cross" becomes **"not cross"**.
 *
 * That inversion is the whole point and the easy thing to get backwards. The spec
 * says what the answer must be; the strip has to say what this flag *is*, which is
 * the opposite of the clause it failed. Printing the clause unchanged would label
 * a green flag "not green" under a spec that already reads "not green", which
 * tells the room nothing and looks like a bug.
 *
 * Returns '' for a flag that satisfies everything -- the answer broke no rule, so
 * its tile gets a bare name.
 *
 * Localised through findFlag's own `pillLabel`, so the words match the criteria
 * line above the tiles exactly, Polish genitive included.
 *
 * @param {Country} c
 * @param {Clause[]} clauses
 * @param {(key: string, fallback: string) => string} translate
 * @returns {string}
 */
export function missLabel(c, clauses, translate) {
  const miss = failingClause(c, clauses);
  if (!miss) return '';
  // A country rule-out: the flag cleared every visible criterion and lost only for
  // being the named country. Its own name (shown on the tile) says which one, so the
  // strip just marks that it was the excluded one — "France · ruled out".
  if (miss.group === 'country') return translate('party.spotRuledOut', 'ruled out');
  const inverted = miss.sign === 'exclude' ? 'include' : 'exclude';
  return pillLabel(miss.group, miss.value, inverted, translate);
}

/**
 * The criteria line shown above the tiles, and kept up through the reveal so the
 * answer can be read against it. findFlag's own title builder, so one criterion
 * reads identically on every surface of the site.
 *
 * @param {Clause[]} clauses
 * @param {(key: string, fallback: string) => string} translate
 * @returns {string}
 */
export function spotTitle(clauses, translate) {
  return filterTitle(filtersFor(clauses), translate);
}

/**
 * @param {{ answer: string }} question
 * @param {string} choice the chosen option's country code
 * @returns {boolean}
 */
export function isCorrect(question, choice) {
  return choice === question.answer;
}
