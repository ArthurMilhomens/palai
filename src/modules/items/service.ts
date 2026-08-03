import { z } from 'zod';
import { prisma } from '../../prisma/client.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { pickTranslation, resolveLocale } from '../../shared/i18n.js';
import { resolveActiveGameVersionId } from '../../shared/version.js';
import {
  buildCraftTree,
  collectAllTotals,
  collectRawTotals,
  type CraftNodeInput,
  type CraftTreeNode,
  type ItemNames,
} from './craft-tree.js';

export const craftTreeQuerySchema = z.object({
  q: z.string().min(1),
  quantity: z.coerce.number().int().positive().default(1),
  rarity: z.coerce.number().int().min(0).max(4).optional(),
  lang: z.string().optional(),
  gameVersion: z.string().optional(),
});

/** Fixed PT labels for weapon/item rarity tiers (0–4). */
export const RARITY_LABELS_PT: Record<number, string> = {
  0: 'Comum',
  1: 'Incomum',
  2: 'Raro',
  3: 'Épico',
  4: 'Lendário',
};

export function rarityLabel(rarity: number | null | undefined): string | null {
  if (rarity == null || !(rarity in RARITY_LABELS_PT)) return null;
  return RARITY_LABELS_PT[rarity] ?? null;
}

/** Split search into tokens: "armadura leve" → ["armadura", "leve"]. */
export function tokenizeSearchQuery(q: string | undefined | null): string[] {
  if (!q) return [];
  return q
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

const itemSelect = {
  id: true,
  internalName: true,
  name: true,
  iconUrl: true,
  rarity: true,
} as const;

type ItemRow = {
  id: string;
  internalName: string;
  name: string;
  iconUrl: string | null;
  rarity: number | null;
};

export type CraftTreeVariant = {
  id: string;
  internalName: string;
  rarity: number | null;
  rarityLabel: string | null;
  iconUrl: string | null;
};

type RecipeRow = {
  id: string;
  resultQuantity: number;
  ingredients: Array<{ quantity: number; item: ItemRow }>;
};

type TranslationRow = {
  entityId: string;
  locale: string;
  field: string;
  value: string;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip trailing `_N` rarity suffix: BowGun_3 → BowGun. */
export function rarityVariantBase(internalName: string): string {
  const m = internalName.match(/^(.*)_\d+$/);
  return m?.[1] ?? internalName;
}

/** True for Base or Base_<digits> of the same family (excludes BowGun_Fire). */
export function isRarityVariantOf(base: string, internalName: string): boolean {
  if (internalName === base) return true;
  return new RegExp(`^${escapeRegex(base)}_\\d+$`).test(internalName);
}

export function sortVariantsByRarity(items: ItemRow[]): ItemRow[] {
  return [...items].sort((a, b) => {
    const ar = a.rarity ?? Number.POSITIVE_INFINITY;
    const br = b.rarity ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.internalName.localeCompare(b.internalName);
  });
}

/**
 * Pick a variant: explicit rarity, else lowest rarity (common).
 * Returns null if rarity was requested but no match.
 */
export function selectVariant(
  variants: ItemRow[],
  rarity?: number,
): ItemRow | null {
  if (variants.length === 0) return null;
  const sorted = sortVariantsByRarity(variants);
  if (rarity == null) return sorted[0] ?? null;
  return sorted.find((v) => v.rarity === rarity) ?? null;
}

function localizedName(
  item: ItemRow,
  translations: TranslationRow[],
  locale: string,
): string {
  const forItem = translations
    .filter((t) => t.entityId === item.id)
    .map((t) => ({ locale: t.locale, field: t.field, value: t.value }));
  return pickTranslation(forItem, 'name', locale, item.name) ?? item.name;
}

function itemNames(item: ItemRow, translations: TranslationRow[]): ItemNames {
  return {
    en: localizedName(item, translations, 'en'),
    'pt-BR': localizedName(item, translations, 'pt-BR'),
  };
}

async function findItemCandidates(
  gameVersionId: string,
  q: string,
): Promise<ItemRow[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];

  const byId = await prisma.item.findFirst({
    where: { gameVersionId, id: trimmed },
    select: itemSelect,
  });
  if (byId) return [byId];

  const exactInternal = await prisma.item.findMany({
    where: {
      gameVersionId,
      internalName: { equals: trimmed, mode: 'insensitive' },
    },
    select: itemSelect,
    take: 10,
  });
  if (exactInternal.length === 1) return exactInternal;

  const exactName = await prisma.item.findMany({
    where: {
      gameVersionId,
      name: { equals: trimmed, mode: 'insensitive' },
    },
    select: itemSelect,
    take: 20,
  });
  if (exactName.length >= 1) return exactName;

  const translationHits = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: 'name',
      value: { equals: trimmed, mode: 'insensitive' },
    },
    select: { entityId: true },
    take: 40,
  });
  if (translationHits.length > 0) {
    const ids = [...new Set(translationHits.map((t) => t.entityId))];
    const items = await prisma.item.findMany({
      where: { gameVersionId, id: { in: ids } },
      select: itemSelect,
    });
    if (items.length >= 1) return items;
  }

  const contains = await prisma.item.findMany({
    where: {
      gameVersionId,
      OR: [
        { internalName: { contains: trimmed, mode: 'insensitive' } },
        { name: { contains: trimmed, mode: 'insensitive' } },
      ],
    },
    select: itemSelect,
    take: 20,
  });
  if (contains.length > 0) return contains;

  const trContains = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: 'name',
      value: { contains: trimmed, mode: 'insensitive' },
    },
    select: { entityId: true },
    take: 40,
  });
  if (trContains.length === 0) return exactInternal.length ? exactInternal : [];
  const ids = [...new Set(trContains.map((t) => t.entityId))];
  return prisma.item.findMany({
    where: { gameVersionId, id: { in: ids } },
    select: itemSelect,
    take: 20,
  });
}

async function loadRarityVariants(
  gameVersionId: string,
  seed: ItemRow,
): Promise<ItemRow[]> {
  const base = rarityVariantBase(seed.internalName);
  const rows = await prisma.item.findMany({
    where: {
      gameVersionId,
      OR: [
        { internalName: base },
        { internalName: { startsWith: `${base}_` } },
        { name: { equals: seed.name, mode: 'insensitive' } },
      ],
    },
    select: itemSelect,
  });

  const byPrefix = rows.filter((r) => isRarityVariantOf(base, r.internalName));
  if (byPrefix.length > 0) return sortVariantsByRarity(byPrefix);

  // Same display name only (no `_N` family under this base)
  const sameName = rows.filter(
    (r) => r.name.toLowerCase() === seed.name.toLowerCase(),
  );
  return sortVariantsByRarity(sameName.length > 0 ? sameName : [seed]);
}

/**
 * Merge overlapping variant families; return one list per distinct family.
 */
export function mergeVariantFamilies(families: ItemRow[][]): ItemRow[][] {
  const groups: ItemRow[][] = [];
  for (const family of families) {
    const ids = new Set(family.map((i) => i.id));
    const overlapIdx = groups.findIndex((g) => g.some((i) => ids.has(i.id)));
    if (overlapIdx >= 0) {
      const merged = new Map<string, ItemRow>();
      for (const item of [...groups[overlapIdx]!, ...family]) {
        merged.set(item.id, item);
      }
      groups[overlapIdx] = sortVariantsByRarity([...merged.values()]);
    } else {
      groups.push(sortVariantsByRarity(family));
    }
  }
  return groups;
}

function pickRecipe(recipes: RecipeRow[]): RecipeRow | null {
  if (recipes.length === 0) return null;
  const sorted = [...recipes].sort((a, b) => {
    const ai = a.ingredients.length;
    const bi = b.ingredients.length;
    if (ai !== bi) return ai - bi;
    return a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}

async function loadRecipeGraph(
  gameVersionId: string,
): Promise<Map<string, RecipeRow[]>> {
  const recipes = await prisma.recipe.findMany({
    where: {
      gameVersionId,
      resultItemId: { not: null },
    },
    select: {
      id: true,
      resultItemId: true,
      resultQuantity: true,
      ingredients: {
        select: {
          quantity: true,
          item: { select: itemSelect },
        },
      },
    },
  });

  const byResult = new Map<string, RecipeRow[]>();
  for (const recipe of recipes) {
    if (!recipe.resultItemId) continue;
    const list = byResult.get(recipe.resultItemId) ?? [];
    list.push({
      id: recipe.id,
      resultQuantity: recipe.resultQuantity,
      ingredients: recipe.ingredients.map((ing) => ({
        quantity: ing.quantity,
        item: ing.item,
      })),
    });
    byResult.set(recipe.resultItemId, list);
  }
  return byResult;
}

function toCraftInput(
  item: ItemRow,
  quantity: number,
  recipesByResult: Map<string, RecipeRow[]>,
  nameOf: (item: ItemRow) => string,
  namesOf: (item: ItemRow) => ItemNames,
  stack: Set<string>,
): CraftNodeInput {
  const names = namesOf(item);
  const iconUrl = item.iconUrl ?? null;
  if (stack.has(item.id)) {
    return {
      id: item.id,
      internalName: item.internalName,
      name: nameOf(item),
      names,
      iconUrl,
      quantity,
      recipe: null,
    };
  }

  const recipe = pickRecipe(recipesByResult.get(item.id) ?? []);
  if (!recipe) {
    return {
      id: item.id,
      internalName: item.internalName,
      name: nameOf(item),
      names,
      iconUrl,
      quantity,
      recipe: null,
    };
  }

  const next = new Set(stack);
  next.add(item.id);

  return {
    id: item.id,
    internalName: item.internalName,
    name: nameOf(item),
    names,
    iconUrl,
    quantity,
    recipe: {
      resultQuantity: recipe.resultQuantity,
      ingredients: recipe.ingredients.map((ing) => {
        const nested = toCraftInput(
          ing.item,
          ing.quantity,
          recipesByResult,
          nameOf,
          namesOf,
          next,
        );
        return {
          id: nested.id,
          internalName: nested.internalName,
          name: nested.name,
          names: nested.names,
          iconUrl: nested.iconUrl,
          quantity: ing.quantity,
          recipe: nested.recipe,
        };
      }),
    },
  };
}

function toVariantDto(item: ItemRow): CraftTreeVariant {
  return {
    id: item.id,
    internalName: item.internalName,
    rarity: item.rarity,
    rarityLabel: rarityLabel(item.rarity),
    iconUrl: item.iconUrl,
  };
}

export async function getItemCraftTree(options: {
  q: string;
  quantity: number;
  rarity?: number;
  lang?: string;
  gameVersion?: string;
  acceptLanguage?: string;
}): Promise<{
  query: string;
  quantity: number;
  locale: string;
  rarity: number | null;
  item: {
    id: string;
    internalName: string;
    name: string;
    names: ItemNames;
    iconUrl: string | null;
    rarity: number | null;
    rarityLabel: string | null;
  };
  variants: CraftTreeVariant[];
  items: CraftTreeNode[];
  totals: ReturnType<typeof collectAllTotals>;
  rawTotals: ReturnType<typeof collectRawTotals>;
}> {
  const gameVersionId = await resolveActiveGameVersionId(options.gameVersion);
  const locale = resolveLocale(
    { headers: { 'accept-language': options.acceptLanguage ?? '' } } as never,
    options.lang,
  );

  const candidates = await findItemCandidates(gameVersionId, options.q);
  if (candidates.length === 0) {
    throw new NotFoundError(`Item not found: ${options.q}`);
  }

  const families = mergeVariantFamilies(
    await Promise.all(
      candidates.map((c) => loadRarityVariants(gameVersionId, c)),
    ),
  );

  if (families.length > 1) {
    throw new ValidationError('Ambiguous item query', {
      query: options.q,
      candidates: families.map((family) => {
        const rep = selectVariant(family) ?? family[0]!;
        return {
          id: rep.id,
          internalName: rep.internalName,
          name: rep.name,
          rarity: rep.rarity,
        };
      }),
    });
  }

  const variants = families[0] ?? [];
  const item = selectVariant(variants, options.rarity);
  if (!item) {
    if (options.rarity != null) {
      throw new NotFoundError(
        `No variant with rarity ${options.rarity} for: ${options.q}`,
        {
          query: options.q,
          rarity: options.rarity,
          variants: variants.map(toVariantDto),
        },
      );
    }
    throw new NotFoundError(`Item not found: ${options.q}`);
  }

  const translations = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: 'name',
    },
    select: { entityId: true, locale: true, field: true, value: true },
  });

  const nameOf = (row: ItemRow) => localizedName(row, translations, locale);
  const namesOf = (row: ItemRow) => itemNames(row, translations);
  const recipesByResult = await loadRecipeGraph(gameVersionId);
  const rootInput = toCraftInput(
    item,
    options.quantity,
    recipesByResult,
    nameOf,
    namesOf,
    new Set(),
  );
  const root = buildCraftTree(rootInput);

  return {
    query: options.q,
    quantity: options.quantity,
    locale,
    rarity: item.rarity,
    item: {
      id: root.id,
      internalName: root.internalName,
      name: root.name,
      names: root.names,
      iconUrl: root.iconUrl,
      rarity: item.rarity,
      rarityLabel: rarityLabel(item.rarity),
    },
    variants: variants.map(toVariantDto),
    items: root.items,
    totals: collectAllTotals(root.items),
    rawTotals: collectRawTotals(root.items),
  };
}

const ITEM_LIST_SORTS = new Set([
  'name',
  'rarity',
  'price',
  'weight',
  'createdAt',
  'internalName',
]);

async function findItemIdsMatchingTokens(
  gameVersionId: string,
  tokens: string[],
): Promise<string[] | null> {
  if (tokens.length === 0) return null;

  // Translations whose value contains ALL tokens (e.g. "Armadura … Leve")
  const translationHits = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: 'name',
      AND: tokens.map((token) => ({
        value: { contains: token, mode: 'insensitive' as const },
      })),
    },
    select: { entityId: true },
  });
  const fromTranslations = [...new Set(translationHits.map((t) => t.entityId))];

  // Item.name / internalName: each token must appear in at least one field
  const fieldMatches = await prisma.item.findMany({
    where: {
      gameVersionId,
      AND: tokens.map((token) => ({
        OR: [
          { name: { contains: token, mode: 'insensitive' as const } },
          { internalName: { contains: token, mode: 'insensitive' as const } },
        ],
      })),
    },
    select: { id: true },
  });

  return [...new Set([...fromTranslations, ...fieldMatches.map((i) => i.id)])];
}

export async function listItems(options: {
  q?: string;
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  rarity?: number;
  lang?: string;
  gameVersion?: string;
  acceptLanguage?: string;
}) {
  const gameVersionId = await resolveActiveGameVersionId(options.gameVersion);
  const locale = resolveLocale(
    { headers: { 'accept-language': options.acceptLanguage ?? '' } } as never,
    options.lang,
  );
  const tokens = tokenizeSearchQuery(options.q);
  const matchedIds = await findItemIdsMatchingTokens(gameVersionId, tokens);

  if (matchedIds && matchedIds.length === 0) {
    return {
      data: [],
      meta: {
        page: options.page,
        limit: options.limit,
        total: 0,
        totalPages: 1,
        sort: options.sort ?? 'name',
        order: options.order,
      },
    };
  }

  const sort = ITEM_LIST_SORTS.has(options.sort ?? '')
    ? (options.sort as string)
    : 'name';

  let familyRows: Array<{
    id: string;
    internalName: string;
    name: string;
    description: string | null;
    iconUrl: string | null;
    rarity: number | null;
    weight: number | null;
    price: number | null;
    stackSize: number | null;
    gameVersionId: string;
    createdAt: Date;
    updatedAt: Date;
  }>;

  if (matchedIds) {
    const seeds = await prisma.item.findMany({
      where: { id: { in: matchedIds } },
      select: { id: true, internalName: true },
    });
    const bases = [...new Set(seeds.map((s) => rarityVariantBase(s.internalName)))];
    const expanded = await prisma.item.findMany({
      where: {
        gameVersionId,
        OR: bases.flatMap((base) => [
          { internalName: base },
          { internalName: { startsWith: `${base}_` } },
        ]),
      },
    });
    familyRows = expanded.filter((row) =>
      bases.some((base) => isRarityVariantOf(base, row.internalName)),
    );
  } else {
    familyRows = await prisma.item.findMany({
      where: {
        gameVersionId,
        ...(options.rarity !== undefined ? { rarity: options.rarity } : {}),
      },
    });
  }

  if (options.rarity !== undefined && matchedIds) {
    familyRows = familyRows.filter((row) => row.rarity === options.rarity);
  }

  const localized = await localizeItems(familyRows, gameVersionId, locale);

  const groups = new Map<string, typeof localized>();
  for (const item of localized) {
    const key = rarityVariantBase(item.internalName);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  let grouped = [...groups.entries()].map(([, family]) => {
    const sorted = [...family].sort((a, b) => {
      const ar = a.rarity ?? Number.POSITIVE_INFINITY;
      const br = b.rarity ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return a.internalName.localeCompare(b.internalName);
    });
    const rep = sorted[0]!;
    return {
      id: rep.id,
      internalName: rep.internalName,
      name: rep.name,
      names: rep.names,
      description: rep.description,
      iconUrl: rep.iconUrl,
      rarity: rep.rarity,
      rarityLabel: rarityLabel(rep.rarity),
      weight: rep.weight,
      price: rep.price,
      stackSize: rep.stackSize,
      variantCount: family.length,
      groupKey: rarityVariantBase(rep.internalName),
    };
  });

  grouped.sort((a, b) => {
    const dir = options.order === 'desc' ? -1 : 1;
    if (sort === 'name') {
      return a.name.localeCompare(b.name, locale) * dir;
    }
    const av = (a as Record<string, unknown>)[sort];
    const bv = (b as Record<string, unknown>)[sort];
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * dir;
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), locale) * dir;
  });

  const total = grouped.length;
  const skip = (options.page - 1) * options.limit;
  const data = grouped.slice(skip, skip + options.limit);

  return {
    data,
    meta: {
      page: options.page,
      limit: options.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / options.limit)),
      sort,
      order: options.order,
    },
  };
}

async function localizeItems<
  T extends { id: string; name: string; description?: string | null },
>(
  items: T[],
  gameVersionId: string,
  locale: string,
): Promise<Array<T & { names: ItemNames; name: string; description: string | null }>> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const translations = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: { in: ['name', 'description'] },
      entityId: { in: ids },
    },
    select: { entityId: true, locale: true, field: true, value: true },
  });

  return items.map((item) => {
    const forItem = translations
      .filter((t) => t.entityId === item.id)
      .map((t) => ({ locale: t.locale, field: t.field, value: t.value }));
    const names: ItemNames = {
      en: pickTranslation(forItem, 'name', 'en', item.name) ?? item.name,
      'pt-BR':
        pickTranslation(forItem, 'name', 'pt-BR', item.name) ?? item.name,
    };
    return {
      ...item,
      name: pickTranslation(forItem, 'name', locale, item.name) ?? item.name,
      description:
        pickTranslation(
          forItem,
          'description',
          locale,
          item.description ?? null,
        ) ?? item.description ?? null,
      names,
    };
  });
}

async function localizePals<
  T extends { id: string; name: string },
>(
  pals: T[],
  gameVersionId: string,
  locale: string,
): Promise<Array<T & { names: ItemNames; name: string }>> {
  if (pals.length === 0) return [];
  const ids = pals.map((p) => p.id);
  const translations = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'pal',
      field: 'name',
      entityId: { in: ids },
    },
    select: { entityId: true, locale: true, field: true, value: true },
  });

  return pals.map((pal) => {
    const forPal = translations
      .filter((t) => t.entityId === pal.id)
      .map((t) => ({ locale: t.locale, field: t.field, value: t.value }));
    const names: ItemNames = {
      en: pickTranslation(forPal, 'name', 'en', pal.name) ?? pal.name,
      'pt-BR': pickTranslation(forPal, 'name', 'pt-BR', pal.name) ?? pal.name,
    };
    return {
      ...pal,
      name: pickTranslation(forPal, 'name', locale, pal.name) ?? pal.name,
      names,
    };
  });
}

export async function getItemDetail(options: {
  idOrSlug: string;
  rarity?: number;
  lang?: string;
  gameVersion?: string;
  acceptLanguage?: string;
}) {
  const gameVersionId = await resolveActiveGameVersionId(options.gameVersion);
  const locale = resolveLocale(
    { headers: { 'accept-language': options.acceptLanguage ?? '' } } as never,
    options.lang,
  );

  let seed = await prisma.item.findFirst({
    where: {
      gameVersionId,
      OR: [
        { id: options.idOrSlug },
        { internalName: options.idOrSlug },
      ],
    },
    select: itemSelect,
  });

  if (!seed) {
    const base = options.idOrSlug;
    const candidates = await prisma.item.findMany({
      where: {
        gameVersionId,
        OR: [
          { internalName: base },
          { internalName: { startsWith: `${base}_` } },
        ],
      },
      select: itemSelect,
    });
    const family = sortVariantsByRarity(
      candidates.filter((c) => isRarityVariantOf(base, c.internalName)),
    );
    seed = family[0] ?? null;
  }

  if (!seed) {
    throw new NotFoundError(`Item not found: ${options.idOrSlug}`);
  }

  const variants = await loadRarityVariants(gameVersionId, seed);
  const selected = selectVariant(variants, options.rarity);
  if (!selected) {
    if (options.rarity != null) {
      throw new NotFoundError(
        `No variant with rarity ${options.rarity} for: ${options.idOrSlug}`,
        {
          rarity: options.rarity,
          variants: variants.map(toVariantDto),
        },
      );
    }
    throw new NotFoundError(`Item not found: ${options.idOrSlug}`);
  }

  const item = await prisma.item.findFirstOrThrow({
    where: { id: selected.id },
  });

  const [localized] = await localizeItems([item], gameVersionId, locale);

  const [drops, craftedRecipes, usedAsIngredient, technologies] =
    await Promise.all([
      prisma.drop.findMany({
        where: { itemId: item.id, gameVersionId },
        include: {
          pal: {
            select: {
              id: true,
              internalName: true,
              name: true,
              iconUrl: true,
            },
          },
        },
        orderBy: [{ chance: 'desc' }, { pal: { name: 'asc' } }],
        take: 50,
      }),
      prisma.recipe.findMany({
        where: { resultItemId: item.id, gameVersionId },
        include: {
          ingredients: {
            include: {
              item: {
                select: {
                  id: true,
                  internalName: true,
                  name: true,
                  iconUrl: true,
                  rarity: true,
                },
              },
            },
          },
        },
        take: 20,
      }),
      prisma.recipeIngredient.findMany({
        where: { itemId: item.id },
        include: {
          recipe: {
            include: {
              resultItem: {
                select: {
                  id: true,
                  internalName: true,
                  name: true,
                  iconUrl: true,
                  rarity: true,
                },
              },
            },
          },
        },
        take: 40,
      }),
      prisma.technology.findMany({
        where: { itemId: item.id, gameVersionId },
        select: {
          id: true,
          internalName: true,
          name: true,
          description: true,
          level: true,
          unlockCost: true,
        },
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
        take: 20,
      }),
    ]);

  const palLocalized = await localizePals(
    drops.map((d) => d.pal),
    gameVersionId,
    locale,
  );
  const palById = new Map(palLocalized.map((p) => [p.id, p]));

  const relatedItemIds = [
    ...craftedRecipes.flatMap((r) => r.ingredients.map((i) => i.item)),
    ...usedAsIngredient
      .map((u) => u.recipe.resultItem)
      .filter((x): x is NonNullable<typeof x> => x != null),
  ];
  const relatedLocalized = await localizeItems(
    relatedItemIds,
    gameVersionId,
    locale,
  );
  const relatedById = new Map(relatedLocalized.map((i) => [i.id, i]));

  return {
    locale,
    ...localized!,
    rarityLabel: rarityLabel(item.rarity),
    variants: variants.map(toVariantDto),
    lootSources: Array.isArray(item.lootSources) ? item.lootSources : [],
    drops: drops.map((d) => {
      const pal = palById.get(d.pal.id) ?? d.pal;
      return {
        chance: d.chance,
        quantityMin: d.quantityMin,
        quantityMax: d.quantityMax,
        pal: {
          id: pal.id,
          internalName: pal.internalName,
          name: pal.name,
          names: 'names' in pal ? pal.names : { en: pal.name, 'pt-BR': pal.name },
          iconUrl: pal.iconUrl,
        },
      };
    }),
    recipes: craftedRecipes.map((r) => ({
      id: r.id,
      internalName: r.internalName,
      craftingStation: r.craftingStation,
      craftTime: r.craftTime,
      resultQuantity: r.resultQuantity,
      ingredients: r.ingredients.map((ing) => {
        const it = relatedById.get(ing.item.id) ?? ing.item;
        return {
          quantity: ing.quantity,
          item: {
            id: it.id,
            internalName: it.internalName,
            name: it.name,
            names:
              'names' in it ? it.names : { en: it.name, 'pt-BR': it.name },
            iconUrl: it.iconUrl,
            rarity: it.rarity,
            rarityLabel: rarityLabel(it.rarity),
          },
        };
      }),
    })),
    usedIn: usedAsIngredient
      .filter((u) => u.recipe.resultItem)
      .map((u) => {
        const result = relatedById.get(u.recipe.resultItem!.id) ?? u.recipe.resultItem!;
        return {
          quantity: u.quantity,
          recipeId: u.recipe.id,
          recipeInternalName: u.recipe.internalName,
          craftingStation: u.recipe.craftingStation,
          resultItem: {
            id: result.id,
            internalName: result.internalName,
            name: result.name,
            names:
              'names' in result
                ? result.names
                : { en: result.name, 'pt-BR': result.name },
            iconUrl: result.iconUrl,
            rarity: result.rarity,
            rarityLabel: rarityLabel(result.rarity),
          },
        };
      }),
    technologies,
  };
}
