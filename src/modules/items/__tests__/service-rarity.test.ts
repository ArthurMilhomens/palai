import { describe, expect, it } from 'vitest';
import {
  isRarityVariantOf,
  mergeVariantFamilies,
  rarityLabel,
  rarityVariantBase,
  selectVariant,
  sortVariantsByRarity,
  tokenizeSearchQuery,
} from '../service.js';

function item(
  internalName: string,
  rarity: number | null,
  name = 'Crossbow',
) {
  return {
    id: internalName.toLowerCase(),
    internalName,
    name,
    iconUrl: null,
    rarity,
  };
}

describe('rarity variant helpers', () => {
  it('strips trailing _N for rarity base', () => {
    expect(rarityVariantBase('BowGun')).toBe('BowGun');
    expect(rarityVariantBase('BowGun_3')).toBe('BowGun');
    expect(rarityVariantBase('BowGun_Fire')).toBe('BowGun_Fire');
  });

  it('matches Base / Base_N only (not BowGun_Fire)', () => {
    expect(isRarityVariantOf('BowGun', 'BowGun')).toBe(true);
    expect(isRarityVariantOf('BowGun', 'BowGun_2')).toBe(true);
    expect(isRarityVariantOf('BowGun', 'BowGun_5')).toBe(true);
    expect(isRarityVariantOf('BowGun', 'BowGun_Fire')).toBe(false);
    expect(isRarityVariantOf('BowGun', 'BowGun_NPC')).toBe(false);
  });

  it('selects lowest rarity when rarity omitted', () => {
    const variants = sortVariantsByRarity([
      item('BowGun_3', 2),
      item('BowGun', 0),
      item('BowGun_5', 4),
    ]);
    expect(selectVariant(variants)?.internalName).toBe('BowGun');
  });

  it('selects BowGun_3 when rarity=2', () => {
    const variants = [
      item('BowGun', 0),
      item('BowGun_2', 1),
      item('BowGun_3', 2),
      item('BowGun_4', 3),
      item('BowGun_5', 4),
    ];
    expect(selectVariant(variants, 2)?.internalName).toBe('BowGun_3');
  });

  it('returns null when requested rarity is missing', () => {
    expect(selectVariant([item('BowGun', 0)], 2)).toBeNull();
  });

  it('maps rarity labels in PT', () => {
    expect(rarityLabel(0)).toBe('Comum');
    expect(rarityLabel(2)).toBe('Raro');
    expect(rarityLabel(4)).toBe('Lendário');
    expect(rarityLabel(null)).toBeNull();
  });

  it('merges overlapping families and keeps distinct ones separate', () => {
    const bow = [
      item('BowGun', 0),
      item('BowGun_3', 2),
    ];
    const bowAgain = [item('BowGun_2', 1), item('BowGun', 0)];
    const wood = [item('Wood', 0, 'Wood')];
    const merged = mergeVariantFamilies([bow, bowAgain, wood]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.map((i) => i.internalName).sort()).toEqual([
      'BowGun',
      'BowGun_2',
      'BowGun_3',
    ]);
    expect(merged[1]![0]!.internalName).toBe('Wood');
  });
});

describe('tokenizeSearchQuery', () => {
  it('splits multi-word queries into tokens', () => {
    expect(tokenizeSearchQuery('armadura leve')).toEqual([
      'armadura',
      'leve',
    ]);
    expect(tokenizeSearchQuery('  Armadura   Leve  ')).toEqual([
      'Armadura',
      'Leve',
    ]);
  });

  it('returns empty for blank queries', () => {
    expect(tokenizeSearchQuery('')).toEqual([]);
    expect(tokenizeSearchQuery('   ')).toEqual([]);
    expect(tokenizeSearchQuery(null)).toEqual([]);
  });
});
