import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCell,
  solutionState,
  continent,
  statehood,
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
