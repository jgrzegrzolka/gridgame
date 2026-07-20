import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DAILY_LIVES, createLives } from './lives.js';

test('a fresh run has every life and is not exhausted', () => {
  const lives = createLives();
  assert.equal(lives.max, DAILY_LIVES);
  assert.equal(lives.remaining(), DAILY_LIVES);
  assert.equal(lives.spent(), 0);
  assert.equal(lives.exhausted(), false);
});

test('spending a wrong country costs one life', () => {
  const lives = createLives(7);
  lives.spend('pt');
  assert.equal(lives.spent(), 1);
  assert.equal(lives.remaining(), 6);
});

test('the same wrong country twice costs one life, not two', () => {
  // The player who retypes a country they already got wrong is not
  // making a second mistake — they are repeating one. Matches how
  // playFlow already dedups `wrongCodes` into a Set for the stats API.
  const lives = createLives(7);
  lives.spend('pt');
  lives.spend('pt');
  assert.equal(lives.spent(), 1);
  assert.equal(lives.remaining(), 6);
});

test('spend reports whether the life actually came off', () => {
  const lives = createLives(7);
  assert.equal(lives.spend('pt'), true);
  assert.equal(lives.spend('pt'), false);
  assert.equal(lives.spend('es'), true);
});

test('the run is exhausted once the last life goes', () => {
  const lives = createLives(3);
  lives.spend('pt');
  lives.spend('es');
  assert.equal(lives.exhausted(), false);
  lives.spend('it');
  assert.equal(lives.exhausted(), true);
  assert.equal(lives.remaining(), 0);
});

test('remaining never goes below zero, even if spend is called again', () => {
  const lives = createLives(2);
  lives.spend('pt');
  lives.spend('es');
  lives.spend('it');
  assert.equal(lives.remaining(), 0);
  assert.equal(lives.exhausted(), true);
});

test('the default cap is 7', () => {
  // Pinned deliberately: the catalog's median puzzle has 8 targets, so a
  // cap of 5 would cut most runs off before the player had seen the bulk
  // of the puzzle. Change this only with the mistake distribution in hand.
  assert.equal(DAILY_LIVES, 7);
});
