import { describe, it, expect } from 'vitest';
import {
  flags,
  criteria,
  rowKeys,
  colKeys,
  buildGrid,
  normalise,
  VALID_COLORS,
} from './flagData';

describe('normalise', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalise('  Côte d\'Ivoire  ')).toBe('cte divoire');
    expect(normalise('United Kingdom')).toBe('united kingdom');
  });
});

describe('flag dataset', () => {
  it('has all UN-recognised flags (≈197)', () => {
    expect(flags.length).toBeGreaterThanOrEqual(195);
  });

  it('has no duplicate country names', () => {
    const names = flags.map(f => f.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('uses only colours from VALID_COLORS', () => {
    const palette = new Set(VALID_COLORS);
    for (const f of flags) {
      for (const c of f.colors) {
        expect(palette.has(c), `${f.name} uses unknown colour "${c}"`).toBe(true);
      }
    }
  });

  it('every flag has at least one colour', () => {
    for (const f of flags) {
      expect(f.colors.length, `${f.name} has no colours`).toBeGreaterThan(0);
    }
  });

  it('every flag has no duplicate colours', () => {
    for (const f of flags) {
      expect(new Set(f.colors).size, `${f.name} has duplicate colours`).toBe(f.colors.length);
    }
  });

  it('every flag declares hasCoatOfArms and hasAnimal as booleans', () => {
    for (const f of flags) {
      expect(typeof f.hasCoatOfArms).toBe('boolean');
      expect(typeof f.hasAnimal).toBe('boolean');
    }
  });
});

describe('criteria', () => {
  it('each criterion is matched by at least one flag', () => {
    for (const key of [...rowKeys, ...colKeys]) {
      const matched = flags.filter(criteria[key].test);
      expect(matched.length, `no flag matches "${key}"`).toBeGreaterThan(0);
    }
  });

  it('hasRed matches Poland but not Sweden', () => {
    const poland = flags.find(f => f.name === 'Poland');
    const sweden = flags.find(f => f.name === 'Sweden');
    expect(criteria.hasRed.test(poland)).toBe(true);
    expect(criteria.hasRed.test(sweden)).toBe(false);
  });

  it('hasGreen matches Italy but not Japan', () => {
    expect(criteria.hasGreen.test(flags.find(f => f.name === 'Italy'))).toBe(true);
    expect(criteria.hasGreen.test(flags.find(f => f.name === 'Japan'))).toBe(false);
  });

  it('has4Colors matches South Africa but not Poland', () => {
    expect(criteria.has4Colors.test(flags.find(f => f.name === 'South Africa'))).toBe(true);
    expect(criteria.has4Colors.test(flags.find(f => f.name === 'Poland'))).toBe(false);
  });

  it('hasAnimal matches Mexico but not France', () => {
    expect(criteria.hasAnimal.test(flags.find(f => f.name === 'Mexico'))).toBe(true);
    expect(criteria.hasAnimal.test(flags.find(f => f.name === 'France'))).toBe(false);
  });

  it('hasCoatOfArms matches Spain but not Germany', () => {
    expect(criteria.hasCoatOfArms.test(flags.find(f => f.name === 'Spain'))).toBe(true);
    expect(criteria.hasCoatOfArms.test(flags.find(f => f.name === 'Germany'))).toBe(false);
  });

  it('noWhite matches China but not Poland', () => {
    expect(criteria.noWhite.test(flags.find(f => f.name === 'China'))).toBe(true);
    expect(criteria.noWhite.test(flags.find(f => f.name === 'Poland'))).toBe(false);
  });
});

describe('game 1 grid', () => {
  const grid = buildGrid();

  it('has 9 cells (3×3)', () => {
    expect(grid).toHaveLength(9);
  });

  it('every cell has at least one valid flag', () => {
    for (const cell of grid) {
      expect(
        cell.validFlags.length,
        `cell ${cell.rowKey} × ${cell.colKey} has no valid flag`,
      ).toBeGreaterThan(0);
    }
  });

  it('every valid flag in a cell satisfies both row and column criteria', () => {
    for (const cell of grid) {
      const rowTest = criteria[cell.rowKey].test;
      const colTest = criteria[cell.colKey].test;
      for (const flag of cell.validFlags) {
        expect(rowTest(flag), `${flag.name} fails row ${cell.rowKey}`).toBe(true);
        expect(colTest(flag), `${flag.name} fails col ${cell.colKey}`).toBe(true);
      }
    }
  });
});
