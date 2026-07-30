import { describe, expect, it } from 'vitest';
import {
  closestByBreedingPower,
  computeTargetRank,
  findFormulaParents,
} from '../formula';

describe('breeding formula', () => {
  it('computes combi rank target', () => {
    expect(computeTargetRank(480, 3050)).toBe(1765);
    expect(computeTargetRank(100, 100)).toBe(100);
  });

  it('finds closest pal by breeding power', () => {
    const pals = [
      { id: '1', breedingPower: 480, name: 'Anubis' },
      { id: '2', breedingPower: 3050, name: 'Lamball' },
      { id: '3', breedingPower: 1760, name: 'Mid' },
      { id: '4', breedingPower: null, name: 'NoBP' },
    ];
    expect(closestByBreedingPower(pals, 1765)?.id).toBe('3');
    expect(closestByBreedingPower([], 10)).toBeNull();
  });

  it('finds formula parents for a child', () => {
    const pals = [
      { id: 'a', internalName: 'A', name: 'A', breedingPower: 100 },
      { id: 'b', internalName: 'B', name: 'B', breedingPower: 300 },
      { id: 'c', internalName: 'C', name: 'C', breedingPower: 200 },
    ];
    const child = pals[2]!;
    const result = findFormulaParents(child, pals);
    expect(result.total).toBeGreaterThan(0);
    expect(
      result.parents.some(
        (p) =>
          (p.parentA.id === 'a' && p.parentB.id === 'b') ||
          (p.parentA.id === 'b' && p.parentB.id === 'a'),
      ),
    ).toBe(true);
  });
});
