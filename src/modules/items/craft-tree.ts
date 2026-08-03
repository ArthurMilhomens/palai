export type ItemNames = {
  en: string;
  'pt-BR': string;
};

export type CraftNodeInput = {
  id: string;
  internalName: string;
  name: string;
  names: ItemNames;
  iconUrl?: string | null;
  quantity: number;
  recipe?: {
    resultQuantity: number;
    ingredients: Array<{
      id: string;
      internalName: string;
      name: string;
      names: ItemNames;
      iconUrl?: string | null;
      quantity: number;
      recipe?: CraftNodeInput['recipe'];
    }>;
  } | null;
};

export type CraftTreeNode = {
  id: string;
  internalName: string;
  name: string;
  names: ItemNames;
  iconUrl: string | null;
  quantity: number;
  craftable: boolean;
  resultQuantity: number | null;
  crafts: number | null;
  items: CraftTreeNode[];
};

export type CraftTotal = {
  id: string;
  internalName: string;
  name: string;
  names: ItemNames;
  iconUrl: string | null;
  quantity: number;
  craftable: boolean;
};

export function craftsNeeded(wanted: number, resultQuantity: number): number {
  const rq = Math.max(1, resultQuantity);
  return Math.ceil(Math.max(0, wanted) / rq);
}

/**
 * Builds a nested craft tree scaled by `wanted` quantity.
 * When multiple recipes exist upstream, pass a single chosen recipe.
 */
export function buildCraftTree(input: CraftNodeInput): CraftTreeNode {
  const recipe = input.recipe;
  if (!recipe || recipe.ingredients.length === 0) {
    return {
      id: input.id,
      internalName: input.internalName,
      name: input.name,
      names: input.names,
      iconUrl: input.iconUrl ?? null,
      quantity: input.quantity,
      craftable: false,
      resultQuantity: null,
      crafts: null,
      items: [],
    };
  }

  const crafts = craftsNeeded(input.quantity, recipe.resultQuantity);
  const items = recipe.ingredients.map((ing) =>
    buildCraftTree({
      id: ing.id,
      internalName: ing.internalName,
      name: ing.name,
      names: ing.names,
      iconUrl: ing.iconUrl ?? null,
      quantity: crafts * ing.quantity,
      recipe: ing.recipe,
    }),
  );

  return {
    id: input.id,
    internalName: input.internalName,
    name: input.name,
    names: input.names,
    iconUrl: input.iconUrl ?? null,
    quantity: input.quantity,
    craftable: true,
    resultQuantity: recipe.resultQuantity,
    crafts,
    items,
  };
}

/** Aggregate leaf (non-craftable) materials across the tree. */
export function collectRawTotals(nodes: CraftTreeNode[]): CraftTotal[] {
  const map = new Map<string, CraftTotal>();

  const walk = (node: CraftTreeNode) => {
    if (!node.craftable || node.items.length === 0) {
      const existing = map.get(node.id);
      if (existing) existing.quantity += node.quantity;
      else {
        map.set(node.id, {
          id: node.id,
          internalName: node.internalName,
          name: node.name,
          names: node.names,
          iconUrl: node.iconUrl,
          quantity: node.quantity,
          craftable: false,
        });
      }
      return;
    }
    for (const child of node.items) walk(child);
  };

  for (const node of nodes) walk(node);
  return [...map.values()].sort((a, b) =>
    a.internalName.localeCompare(b.internalName),
  );
}

/** Aggregate every distinct item quantity that appears in the tree (incl. intermediates). */
export function collectAllTotals(nodes: CraftTreeNode[]): CraftTotal[] {
  const map = new Map<string, CraftTotal>();

  const walk = (node: CraftTreeNode) => {
    const existing = map.get(node.id);
    if (existing) existing.quantity += node.quantity;
    else {
      map.set(node.id, {
        id: node.id,
        internalName: node.internalName,
        name: node.name,
        names: node.names,
        iconUrl: node.iconUrl,
        quantity: node.quantity,
        craftable: node.craftable,
      });
    }
    for (const child of node.items) walk(child);
  };

  for (const node of nodes) walk(node);
  return [...map.values()].sort((a, b) =>
    a.internalName.localeCompare(b.internalName),
  );
}
