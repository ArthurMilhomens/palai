import { describe, expect, it } from 'vitest';
import {
  buildCraftTree,
  craftsNeeded,
  collectAllTotals,
  collectRawTotals,
} from '../craft-tree.js';

describe('craft-tree math', () => {
  it('computes crafts with resultQuantity > 1', () => {
    expect(craftsNeeded(5, 1)).toBe(5);
    expect(craftsNeeded(10, 2)).toBe(5);
    expect(craftsNeeded(11, 2)).toBe(6);
    expect(craftsNeeded(0, 2)).toBe(0);
  });

  it('scales nested ingredients (5 computers → 10 circuits → 20 quartz)', () => {
    const names = { en: 'Computer', 'pt-BR': 'Computador' };
    const circuitNames = { en: 'Circuit', 'pt-BR': 'Circuito elétrico' };
    const quartzNames = { en: 'Quartz', 'pt-BR': 'Quartzo' };
    const root = buildCraftTree({
      id: 'computer',
      internalName: 'Computer',
      name: 'Computador',
      names,
      iconUrl: null,
      quantity: 5,
      recipe: {
        resultQuantity: 1,
        ingredients: [
          {
            id: 'circuit',
            internalName: 'ElectronicCircuit',
            name: 'Circuito elétrico',
            names: circuitNames,
            iconUrl: null,
            quantity: 2,
            recipe: {
              resultQuantity: 1,
              ingredients: [
                {
                  id: 'quartz',
                  internalName: 'Quartz',
                  name: 'Quartzo',
                  names: quartzNames,
                  iconUrl: null,
                  quantity: 2,
                },
              ],
            },
          },
        ],
      },
    });

    expect(root.crafts).toBe(5);
    expect(root.names['pt-BR']).toBe('Computador');
    expect(root.items).toHaveLength(1);
    expect(root.items[0]!.quantity).toBe(10);
    expect(root.items[0]!.names['pt-BR']).toBe('Circuito elétrico');
    expect(root.items[0]!.items[0]!.quantity).toBe(20);

    const raw = collectRawTotals(root.items);
    expect(raw).toEqual([
      expect.objectContaining({
        internalName: 'Quartz',
        quantity: 20,
        craftable: false,
        names: quartzNames,
      }),
    ]);

    const all = collectAllTotals(root.items);
    expect(all.find((t) => t.internalName === 'ElectronicCircuit')?.quantity).toBe(
      10,
    );
    expect(all.find((t) => t.internalName === 'Quartz')?.quantity).toBe(20);
  });

  it('marks uncraftable leaves', () => {
    const leaf = buildCraftTree({
      id: 'wood',
      internalName: 'Wood',
      name: 'Wood',
      names: { en: 'Wood', 'pt-BR': 'Madeira' },
      iconUrl: null,
      quantity: 3,
      recipe: null,
    });
    expect(leaf.craftable).toBe(false);
    expect(leaf.names['pt-BR']).toBe('Madeira');
    expect(leaf.items).toEqual([]);
  });
});
