/**
 * The lobby's segmented radiogroups — the keyboard arithmetic, extracted.
 *
 * Flag Party's lobby has two of these now (game length, first round) and they
 * behaved identically by copy rather than by construction: `syncDraftFirstPick` was a
 * line-for-line duplicate of `syncDraftLength`, and the two `keydown` handlers
 * differed only in which array they indexed. Copies of a named UI behaviour are
 * the thing `CLAUDE.md` calls a bug even while they are byte-identical, because
 * the second one silently stops matching the first the moment either is touched.
 *
 * The wrapping arithmetic is also real logic that was sitting in DOM glue, where
 * it could not be tested. It is the part with edges: Home/End, wrap in both
 * directions, and a current value that is not in the list at all.
 */

/** The keys a radiogroup answers to. Anything else the group ignores, so it does
 *  not swallow Tab, Enter, or a page shortcut. */
export const RADIO_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/**
 * Which option a keypress selects.
 *
 * Both axes move: a segmented row reads as horizontal, but Up/Down are what a
 * screen reader user reaches for and `role="radiogroup"` promises them. Left/Up
 * step back, Right/Down step forward, and both wrap — a three-segment control is
 * small enough that wrapping is faster than stopping, and stopping at the end of a
 * radiogroup is the behaviour users read as "broken", not as "bounded".
 *
 * A `current` that is not in `ids` (a value from a newer build, or a room that has
 * not told us its setting yet) steps from the START rather than throwing: `-1 + 1`
 * lands on the first option, which is the sane place for a first keypress to go.
 *
 * @param {string[]} ids  the group's options, in display order
 * @param {string} current  the option checked right now
 * @param {string} key  a KeyboardEvent.key
 * @returns {string | null}  the option to select, or null if the key is not ours
 *   or the group is empty
 */
export function nextRadioId(ids, current, key) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  if (!RADIO_KEYS.includes(key)) return null;
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[ids.length - 1];
  const step = (key === 'ArrowRight' || key === 'ArrowDown') ? 1 : -1;
  const i = ids.indexOf(current);
  // `+ ids.length` before the modulo: JS `%` keeps the sign, so stepping back
  // from index 0 would otherwise land on -1 and read as undefined.
  return ids[(i + step + ids.length) % ids.length];
}

/**
 * Paint one segmented group: which option is checked, and whether this seat may
 * change it.
 *
 * The read-only half is a deliberate shape shared by both controls: a guest sees
 * the host's choice **in the same place, in the same shape, minus the
 * affordances** — and specifically NOT dimmed. These settings decide what the
 * guest is about to play and how long they are staying, so they are information
 * being given, not a control being withheld; the disabled-grey read would make the
 * chosen value harder to see for the person who cannot change it.
 *
 * @param {HTMLButtonElement[]} btns  the group's option buttons
 * @param {HTMLElement} groupEl  the element carrying `role="radiogroup"`
 * @param {string} dataKey  the dataset key holding each button's id ('length' / 'firstPick')
 * @param {string} current  the option checked right now
 * @param {boolean} editable  whether this seat may change it (the host)
 */
export function paintRadioGroup(btns, groupEl, dataKey, current, editable) {
  for (const btn of btns) {
    const on = btn.dataset[dataKey] === current;
    btn.setAttribute('aria-checked', String(on));
    btn.disabled = !editable;
    // A disabled radiogroup is not a tab stop at all. For the host this keeps the
    // roving tabindex `role="radiogroup"` promises: one stop, arrows move within.
    btn.tabIndex = editable && on ? 0 : -1;
  }
  groupEl.classList.toggle('is-readonly', !editable);
}
