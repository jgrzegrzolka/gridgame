import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCell,
  solutionState,
  tryPick,
  continent,
  statehood,
  nameStartsWith,
  suggest,
} from './grid.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return {
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...fields,
  };
}

const FR = country({ code: 'fr', name: 'France', continent: 'Europe', statehood: 'un_member' });
const DE = country({ code: 'de', name: 'Germany', continent: 'Europe', statehood: 'un_member' });
const VA = country({ code: 'va', name: 'Vatican', continent: 'Europe', statehood: 'un_observer' });
const GL = country({ code: 'gl', name: 'Greenland', continent: 'Europe', statehood: 'territory' });
const JP = country({ code: 'jp', name: 'Japan', continent: 'Asia', statehood: 'un_member' });
const HK = country({ code: 'hk', name: 'Hong Kong', continent: 'Asia', statehood: 'territory' });
const KE = country({ code: 'ke', name: 'Kenya', continent: 'Africa', statehood: 'un_member' });

const EUROPE = continent('Europe');
const ASIA = continent('Asia');
const AFRICA = continent('Africa');

const UN = statehood('un_member', 'UN member');
const OBSERVER = statehood('un_observer', 'UN observer');
const TERRITORY = statehood('territory', 'Territory');

/** @type {import('./grid.js').Puzzle} */
const PUZZLE = {
  rows: [EUROPE, ASIA, AFRICA],
  cols: [UN, OBSERVER, TERRITORY],
};

test('continent predicate matches countries on that continent', () => {
  assert.equal(EUROPE.predicate(FR), true);
  assert.equal(EUROPE.predicate(JP), false);
});

test('continent category has a stable id and label', () => {
  assert.equal(EUROPE.id, 'continent:Europe');
  assert.equal(EUROPE.label, 'Europe');
});

test('statehood predicate matches countries with that statehood', () => {
  assert.equal(UN.predicate(FR), true);
  assert.equal(UN.predicate(VA), false);
  assert.equal(TERRITORY.predicate(GL), true);
});

test('statehood category defaults label to a humanised value', () => {
  assert.equal(statehood('un_member').label, 'un member');
  assert.equal(statehood('un_member', 'UN member').label, 'UN member');
});

test('nameStartsWith predicate matches countries whose name starts with the letter', () => {
  assert.equal(nameStartsWith('A').predicate(country({ code: 'al', name: 'Albania' })), true);
  assert.equal(nameStartsWith('A').predicate(country({ code: 'be', name: 'Belgium' })), false);
});

test('nameStartsWith is case-insensitive in both the letter and the country name', () => {
  assert.equal(nameStartsWith('a').predicate(country({ code: 'al', name: 'Albania' })), true);
  assert.equal(nameStartsWith('A').predicate(country({ code: 'al', name: 'albania' })), true);
});

test('suggest returns an empty list while the trimmed query is under 3 characters', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'de', name: 'Germany' }),
  ];
  assert.deepEqual(suggest(countries, ''), []);
  assert.deepEqual(suggest(countries, 'f'), []);
  assert.deepEqual(suggest(countries, 'fr'), []);
});

test('suggest treats whitespace-only queries as too short', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  assert.deepEqual(suggest(countries, '   '), []);
});

test('suggest matches by case-insensitive substring once the query reaches 3 chars', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'fi', name: 'Finland' }),
    country({ code: 'de', name: 'Germany' }),
  ];
  assert.deepEqual(suggest(countries, 'fra').map((c) => c.code), ['fr']);
  assert.deepEqual(suggest(countries, 'FRA').map((c) => c.code), ['fr']);
});

test('suggest matches a substring that appears anywhere in the name, not just the prefix', () => {
  const countries = [
    country({ code: 'is', name: 'Iceland' }),
    country({ code: 'gl', name: 'Greenland' }),
    country({ code: 'es', name: 'Spain' }),
  ];
  assert.deepEqual(
    suggest(countries, 'and').map((c) => c.code).sort(),
    ['gl', 'is'],
  );
});

test('suggest matches against country names case-insensitively', () => {
  const countries = [country({ code: 'fr', name: 'france' })];
  assert.deepEqual(suggest(countries, 'FRA').map((c) => c.code), ['fr']);
});

test('suggest trims whitespace around the query', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  assert.deepEqual(suggest(countries, '  fra  ').map((c) => c.code), ['fr']);
});

test('suggest returns an empty list when nothing matches the query', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  assert.deepEqual(suggest(countries, 'xyz'), []);
});

test('suggest caps results at the default limit of 8', () => {
  const countries = Array.from({ length: 20 }, (_, i) =>
    country({ code: `c${i}`, name: `Country${i}` })
  );
  assert.equal(suggest(countries, 'cou').length, 8);
});

test('suggest respects a custom limit', () => {
  const countries = Array.from({ length: 20 }, (_, i) =>
    country({ code: `c${i}`, name: `Country${i}` })
  );
  assert.equal(suggest(countries, 'cou', { limit: 3 }).length, 3);
});

test('suggest excludes countries whose codes are in excludeCodes', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'fi', name: 'Finland' }),
  ];
  const result = suggest(countries, 'fin', { excludeCodes: new Set(['fi']) });
  assert.deepEqual(result.map((c) => c.code), []);
});

test('suggest only excludes the codes listed in excludeCodes, not unrelated matches', () => {
  const countries = [
    country({ code: 'fr', name: 'France' }),
    country({ code: 'fra', name: 'Franconia' }),
  ];
  const result = suggest(countries, 'fra', { excludeCodes: new Set(['fr']) });
  assert.deepEqual(result.map((c) => c.code), ['fra']);
});

test('suggest with an empty excludeCodes set behaves the same as no excludeCodes', () => {
  const countries = [country({ code: 'fr', name: 'France' })];
  const withEmpty = suggest(countries, 'fra', { excludeCodes: new Set() });
  const without = suggest(countries, 'fra');
  assert.deepEqual(withEmpty, without);
});

test('validateCell is true when country satisfies both row and column', () => {
  assert.equal(validateCell(PUZZLE, 0, 0, FR), true);   // Europe x UN -> France
  assert.equal(validateCell(PUZZLE, 0, 1, VA), true);   // Europe x Observer -> Vatican
  assert.equal(validateCell(PUZZLE, 1, 2, HK), true);   // Asia x Territory -> Hong Kong
});

test('validateCell is false when the row predicate fails', () => {
  // Japan is in Asia, but cell (0, 0) wants Europe.
  assert.equal(validateCell(PUZZLE, 0, 0, JP), false);
});

test('validateCell is false when the column predicate fails', () => {
  // France is in Europe, but cell (0, 1) wants Observer (France is UN member).
  assert.equal(validateCell(PUZZLE, 0, 1, FR), false);
});

test('validateCell is false for an empty cell (null country)', () => {
  assert.equal(validateCell(PUZZLE, 0, 0, null), false);
});

test('solutionState marks an empty solution as no-cell-filled and not complete', () => {
  const empty = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  const state = solutionState(PUZZLE, empty);
  assert.equal(state.complete, false);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.deepEqual(state.cells[r][c], { filled: false, valid: false, duplicate: false });
    }
  }
});

test('solutionState reports filled+valid for a correct pick', () => {
  const solution = [
    [FR,   null, null],
    [null, null, null],
    [null, null, null],
  ];
  const state = solutionState(PUZZLE, solution);
  assert.deepEqual(state.cells[0][0], { filled: true, valid: true, duplicate: false });
  assert.equal(state.complete, false); // other cells still empty
});

test('solutionState reports filled-but-invalid when a wrong country is dropped in', () => {
  const solution = [
    [JP,   null, null],   // Japan: wrong continent for row 0 (Europe)
    [null, null, null],
    [null, null, null],
  ];
  const state = solutionState(PUZZLE, solution);
  assert.deepEqual(state.cells[0][0], { filled: true, valid: false, duplicate: false });
});

test('solutionState flags duplicates on every cell where the same country appears', () => {
  const solution = [
    [FR,   null, null],
    [null, null, null],
    [null, null, null],
  ];
  // Drop France into another cell where it also happens to be valid?
  // Europe x UN at (0, 0) and Asia x UN at (1, 0): France only satisfies (0, 0)
  // so to test duplicate-but-valid we'd need a country that fits two cells.
  // Use Germany at (0, 0) and France at... well, both Europe x UN. Reuse FR.
  solution[0][0] = FR;
  solution[0][1] = FR; // not valid for col 1 (Observer), but duplicate is still flagged
  const state = solutionState(PUZZLE, solution);
  assert.equal(state.cells[0][0].duplicate, true);
  assert.equal(state.cells[0][1].duplicate, true);
});

test('solutionState.complete is true when all nine cells are filled, valid, and distinct', () => {
  // A puzzle we know we can fully solve with distinct test countries.
  // Need a country for each (continent, statehood) intersection.
  // Reusing the same continent-row across columns means picking three
  // distinct countries from that continent with the three different statehoods.
  const FR2 = country({ code: 'de', name: 'Germany', continent: 'Europe', statehood: 'un_member' });
  // For row 0 (Europe): FR (UN), VA (Observer), GL (Territory) -> three distinct codes.
  // For row 1 (Asia): JP (UN), PS-like fake Observer, HK (Territory).
  const PS = country({ code: 'ps', name: 'Palestine', continent: 'Asia', statehood: 'un_observer' });
  // For row 2 (Africa): KE (UN), fake Observer, fake Territory.
  const AF_OBS = country({ code: 'aob', name: 'AfricaObs', continent: 'Africa', statehood: 'un_observer' });
  const AF_TER = country({ code: 'ater', name: 'AfricaTer', continent: 'Africa', statehood: 'territory' });

  const solution = [
    [FR, VA, GL],
    [JP, PS, HK],
    [KE, AF_OBS, AF_TER],
  ];
  const state = solutionState(PUZZLE, solution);
  assert.equal(state.complete, true);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.deepEqual(state.cells[r][c], { filled: true, valid: true, duplicate: false });
    }
  }
});

function emptySolution() {
  return [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
}

test('tryPick accepts a valid, unique pick and returns a new solution with the pick placed', () => {
  const before = emptySolution();
  const result = tryPick(PUZZLE, before, 0, 0, FR);
  assert.equal(result.accepted, true);
  assert.equal(result.solution[0][0], FR);
  // Untouched cells remain null in the new solution.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 0 && c === 0) continue;
      assert.equal(result.solution[r][c], null);
    }
  }
});

test('tryPick rejects when the row predicate fails', () => {
  const result = tryPick(PUZZLE, emptySolution(), 0, 0, JP); // Asia in Europe row
  assert.equal(result.accepted, false);
  assert.equal(result.solution, undefined);
});

test('tryPick rejects when the column predicate fails', () => {
  const result = tryPick(PUZZLE, emptySolution(), 0, 1, FR); // FR is UN, col 1 is Observer
  assert.equal(result.accepted, false);
});

test('tryPick rejects a duplicate of a country already placed elsewhere', () => {
  // Puzzle where two cells both accept FR (Europe + UN), so the duplicate
  // path is exercised cleanly rather than masked by a predicate fail.
  const dupPuzzle = {
    rows: [EUROPE, EUROPE, AFRICA],
    cols: [UN, UN, TERRITORY],
  };
  const solution = emptySolution();
  solution[0][0] = FR;
  const result = tryPick(dupPuzzle, solution, 1, 1, FR);
  assert.equal(result.accepted, false);
});

test('tryPick rejects any pick on an already-filled cell (placed cells are locked)', () => {
  const solution = emptySolution();
  solution[0][0] = FR;
  // DE is a perfectly valid Europe + UN pick that would be accepted at
  // (0,0) if the cell were empty — but the cell is filled, so reject.
  const result = tryPick(PUZZLE, solution, 0, 0, DE);
  assert.equal(result.accepted, false);
  assert.equal(result.solution, undefined);
});

test('tryPick rejects re-picking the same country into its own already-filled cell', () => {
  const solution = emptySolution();
  solution[0][0] = FR;
  const result = tryPick(PUZZLE, solution, 0, 0, FR);
  assert.equal(result.accepted, false);
});

test('tryPick does not mutate the original solution on accept', () => {
  const before = emptySolution();
  before[1][1] = JP;
  const snapshot = before.map((r) => r.slice());
  tryPick(PUZZLE, before, 0, 0, FR);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(before[r][c], snapshot[r][c]);
    }
  }
});

test('solutionState.complete is false when one cell is invalid even if all are filled and distinct', () => {
  const PS = country({ code: 'ps', name: 'Palestine', continent: 'Asia', statehood: 'un_observer' });
  const AF_OBS = country({ code: 'aob', name: 'AfricaObs', continent: 'Africa', statehood: 'un_observer' });
  const AF_TER = country({ code: 'ater', name: 'AfricaTer', continent: 'Africa', statehood: 'territory' });

  const solution = [
    [FR, VA, GL],
    [JP, PS, HK],
    [KE, AF_OBS, FR], // bottom-right is France: wrong continent (Europe vs Africa); also duplicates FR at (0,0)
  ];
  const state = solutionState(PUZZLE, solution);
  assert.equal(state.complete, false);
  assert.equal(state.cells[2][2].valid, false);
});
