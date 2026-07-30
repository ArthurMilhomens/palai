import { describe, expect, it } from 'vitest';
import {
  parseGameDump,
  validateGameDump,
} from '../game-dump';

const sampleDump = {
  version: '1.0.0',
  build: '100',
  elements: [{ internalName: 'Fire', name: 'Fire' }],
  skills: [
    {
      internalName: 'Skill_FireBall',
      name: 'Fire Ball',
      power: 70,
      cooldown: 5,
      element: 'Fire',
      category: 'ACTIVE' as const,
    },
  ],
  passives: [
    {
      internalName: 'Legend',
      name: 'Legend',
      rarity: 4,
      modifiers: { attack: 0.2 },
    },
  ],
  items: [
    {
      internalName: 'PalFluid',
      name: 'Pal Fluid',
      rarity: 1,
      stackSize: 9999,
    },
  ],
  pals: [
    {
      internalName: 'Anubis',
      paldexNumber: 99,
      name: 'Anubis',
      description: 'Guardian of the desert',
      breedingPower: 480,
      hp: 120,
      attack: 130,
      defense: 100,
      elements: ['Fire'],
      activeSkills: ['Skill_FireBall'],
      passiveSkills: ['Legend'],
      workSuitabilities: [{ type: 'Handiwork', level: 4 }],
      drops: [{ item: 'PalFluid', chance: 0.5, quantityMin: 1, quantityMax: 2 }],
      habitats: [],
    },
    {
      internalName: 'Lamball',
      paldexNumber: 1,
      name: 'Lamball',
      breedingPower: 3050,
      elements: [],
      activeSkills: [],
      passiveSkills: [],
      workSuitabilities: [{ type: 'Farming', level: 1 }],
      drops: [],
      habitats: [],
    },
  ],
  recipes: [],
  technologies: [],
  locations: [],
  dungeons: [],
  bosses: [],
  breedingOverrides: [],
  translations: [
    {
      entityType: 'pal',
      entityInternalName: 'Anubis',
      locale: 'pt-BR',
      field: 'name',
      value: 'Anúbis',
    },
  ],
};

describe('game dump parser', () => {
  it('parses a valid dump', () => {
    const dump = parseGameDump(sampleDump);
    expect(dump.version).toBe('1.0.0');
    expect(dump.pals).toHaveLength(2);
    expect(dump.pals[0]?.breedingPower).toBe(480);
  });

  it('rejects invalid dump', () => {
    const result = validateGameDump({ version: 1, pals: [{ name: 'x' }] });
    expect(result.success).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('applies defaults for optional arrays', () => {
    const dump = parseGameDump({ version: '1.0.0' });
    expect(dump.elements).toEqual([]);
    expect(dump.pals).toEqual([]);
  });
});
