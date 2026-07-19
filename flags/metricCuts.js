/**
 * Metric cuts: the metrics that are one subject measured two ways.
 *
 * The world-facts chip row grew to 39 chips, and five of those subjects were
 * sitting in it twice — GDP next to GDP per capita, Nobel next to Nobel per
 * million, both Olympic pairs, population next to density. Two chips for one
 * subject asks the reader to arbitrate "total or normalised" from the row,
 * before they have seen a single number, and it spends two slots doing it.
 *
 * A cut is NOT a related metric. The bar is "the same quantity divided by
 * something", which is why coffee production and coffee consumption would pair
 * but sheep-per-person and cattle-per-person do not: those are two subjects
 * that happen to share a barn. Metrics that only exist normalised (beer, meat,
 * tourism, electricity, McDonald's) are not cuts either — there is no second
 * view to switch to, so they stay ordinary single-key metrics with no control.
 *
 * **A group's id IS its total metric's key.** That is what keeps this small:
 * the chip, its icon, its hue, its i18n and its tier breakpoints all keep
 * resolving through the key they already used, and only the secondary cut
 * disappears from the row. Nothing needs a synthetic id.
 *
 * Pure data + lookups: no DOM, no i18n resolution (labels are key/fallback
 * pairs the caller translates), so `flagsdata/page.js` keeps only the wiring.
 */

/**
 * @typedef {{ cut: 'total' | 'per', key: string, label: { key: string, fallback: string } }} MetricCut
 * @typedef {{ subjectKey: string, cuts: MetricCut[] }} MetricCutGroup
 */

const TOTAL = { key: 'flagsdata.cutTotal', fallback: 'Total' };
const PER_PERSON = { key: 'flagsdata.cutPerPerson', fallback: 'Per person' };
const PER_AREA = { key: 'flagsdata.cutPerArea', fallback: 'Per km²' };

/** @type {MetricCutGroup[]} */
export const METRIC_CUT_GROUPS = [
  {
    // Density is population per square kilometre, so its cut label is the one
    // exception to "per person" — the axis is the same (a total, normalised),
    // the divisor is not.
    subjectKey: 'population',
    cuts: [
      { cut: 'total', key: 'population', label: TOTAL },
      { cut: 'per', key: 'density', label: PER_AREA },
    ],
  },
  {
    subjectKey: 'gdp',
    cuts: [
      { cut: 'total', key: 'gdp', label: TOTAL },
      { cut: 'per', key: 'gdpPerCapita', label: PER_PERSON },
    ],
  },
  {
    subjectKey: 'nobel',
    cuts: [
      { cut: 'total', key: 'nobel', label: TOTAL },
      { cut: 'per', key: 'nobelPerCapita', label: PER_PERSON },
    ],
  },
  {
    // Summer and Winter stay two chips on purpose. They are different subjects
    // — different countries, different data files — where total vs per-person
    // is one subject divided. Collapsing the seasons too would leave one icon
    // and one hue standing for the torch and the snowflake at once, and cost
    // the row its direct route to Winter.
    subjectKey: 'summerMedals',
    cuts: [
      { cut: 'total', key: 'summerMedals', label: TOTAL },
      { cut: 'per', key: 'summerMedalsPerCapita', label: PER_PERSON },
    ],
  },
  {
    subjectKey: 'winterMedals',
    cuts: [
      { cut: 'total', key: 'winterMedals', label: TOTAL },
      { cut: 'per', key: 'winterMedalsPerCapita', label: PER_PERSON },
    ],
  },
];

/** @type {Record<string, MetricCutGroup>} */
const BY_SUBJECT = Object.fromEntries(METRIC_CUT_GROUPS.map((g) => [g.subjectKey, g]));

/** @type {Record<string, MetricCutGroup>} */
const BY_MEMBER = Object.fromEntries(
  METRIC_CUT_GROUPS.flatMap((g) => g.cuts.map((c) => [c.key, g])),
);

/**
 * The cuts a chip offers, or null for an ordinary metric. Null is the signal
 * to render no cut control at all — a single-view metric must not grow a
 * one-button segmented control.
 *
 * @param {string | null} subjectKey
 * @returns {MetricCut[] | null}
 */
export function cutsFor(subjectKey) {
  if (!subjectKey) return null;
  const group = BY_SUBJECT[subjectKey];
  return group ? group.cuts : null;
}

/**
 * The metric key a (chip, cut) pair actually reads. Falls back to the chip's
 * own key for an ordinary metric, or for a cut this subject doesn't have, so
 * a caller can resolve unconditionally.
 *
 * @param {string | null} subjectKey
 * @param {'total' | 'per'} [cut]
 * @returns {string | null}
 */
export function resolveCut(subjectKey, cut = 'total') {
  if (!subjectKey) return null;
  const group = BY_SUBJECT[subjectKey];
  if (!group) return subjectKey;
  const hit = group.cuts.find((c) => c.cut === cut);
  return hit ? hit.key : subjectKey;
}

/**
 * The chip a metric key lives under: its group's subject, or the key itself.
 * Lets a caller point at `gdpPerCapita` and get back the chip that reaches it.
 *
 * @param {string | null} metricKey
 * @returns {string | null}
 */
export function subjectFor(metricKey) {
  if (!metricKey) return null;
  const group = BY_MEMBER[metricKey];
  return group ? group.subjectKey : metricKey;
}

/**
 * True for a metric that is reachable only through another chip's cut control.
 * These are the keys the chip row drops.
 *
 * @param {string} metricKey
 * @returns {boolean}
 */
export function isSecondaryCut(metricKey) {
  const group = BY_MEMBER[metricKey];
  return Boolean(group) && group.subjectKey !== metricKey;
}

/**
 * The chip row's metrics: the registry minus every secondary cut. Order is
 * preserved, so the row keeps the registry's curation.
 *
 * @template {{ key: string }} T
 * @param {T[]} metrics
 * @returns {T[]}
 */
export function chipMetrics(metrics) {
  return metrics.filter((m) => !isSecondaryCut(m.key));
}
