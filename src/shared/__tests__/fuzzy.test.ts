import { describe, expect, it } from 'vitest';
import { bestFuzzyScore, fuzzyScore, normalizeSearchText } from '../fuzzy.js';

describe('fuzzy search', () => {
  it('normalizes accents', () => {
    expect(normalizeSearchText('Arco Mecânico')).toBe('arco mecanico');
  });

  it('matches typos like meacnico → mecânico', () => {
    expect(fuzzyScore('arco meacnico', 'Arco Mecânico')).toBeGreaterThan(0.8);
    expect(bestFuzzyScore('arco meacnico', ['Arco Mecânico', 'Bow'])).toBeGreaterThan(
      0.8,
    );
  });

  it('does not match arco inside charcoal', () => {
    expect(fuzzyScore('arco', 'Charcoal')).toBeLessThan(0.72);
    expect(fuzzyScore('arco', 'Carvão Vegetal')).toBeLessThan(0.72);
  });

  it('matches short shared token queries', () => {
    expect(fuzzyScore('arco', 'Arco Mecânico')).toBeGreaterThan(0.7);
    expect(fuzzyScore('arco', 'Arco de Madeira')).toBeGreaterThan(0.7);
  });

  it('rejects unrelated names', () => {
    expect(fuzzyScore('arco meacnico', 'Espada de Ferro')).toBe(0);
  });
});
