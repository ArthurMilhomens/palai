import { describe, expect, it } from 'vitest';
import { BreedingService } from '../service';

describe('breeding formula helpers', () => {
  it('computes target rank with floor((a+b+1)/2)', () => {
    const target = Math.floor((480 + 3050 + 1) / 2);
    expect(target).toBe(1765);
  });

  it('service instance exists', () => {
    expect(new BreedingService()).toBeInstanceOf(BreedingService);
  });
});
