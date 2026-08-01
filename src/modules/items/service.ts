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
  lang: z.string().optional(),
  gameVersion: z.string().optional(),
});

type ItemRow = {
  id: string;
  internalName: string;
  name: string;
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
    select: { id: true, internalName: true, name: true },
  });
  if (byId) return [byId];

  const exactInternal = await prisma.item.findMany({
    where: {
      gameVersionId,
      internalName: { equals: trimmed, mode: 'insensitive' },
    },
    select: { id: true, internalName: true, name: true },
    take: 10,
  });
  if (exactInternal.length === 1) return exactInternal;

  const exactName = await prisma.item.findMany({
    where: {
      gameVersionId,
      name: { equals: trimmed, mode: 'insensitive' },
    },
    select: { id: true, internalName: true, name: true },
    take: 10,
  });
  if (exactName.length === 1) return exactName;

  const translationHits = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: 'name',
      value: { equals: trimmed, mode: 'insensitive' },
    },
    select: { entityId: true },
    take: 20,
  });
  if (translationHits.length > 0) {
    const ids = [...new Set(translationHits.map((t) => t.entityId))];
    const items = await prisma.item.findMany({
      where: { gameVersionId, id: { in: ids } },
      select: { id: true, internalName: true, name: true },
    });
    if (items.length === 1) return items;
    if (items.length > 1) return items;
  }

  // Fuzzy contains as last resort
  const contains = await prisma.item.findMany({
    where: {
      gameVersionId,
      OR: [
        { internalName: { contains: trimmed, mode: 'insensitive' } },
        { name: { contains: trimmed, mode: 'insensitive' } },
      ],
    },
    select: { id: true, internalName: true, name: true },
    take: 10,
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
    take: 20,
  });
  if (trContains.length === 0) return exactInternal.length ? exactInternal : [];
  const ids = [...new Set(trContains.map((t) => t.entityId))];
  return prisma.item.findMany({
    where: { gameVersionId, id: { in: ids } },
    select: { id: true, internalName: true, name: true },
    take: 10,
  });
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
          item: { select: { id: true, internalName: true, name: true } },
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
  if (stack.has(item.id)) {
    return {
      id: item.id,
      internalName: item.internalName,
      name: nameOf(item),
      names,
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
          quantity: ing.quantity,
          recipe: nested.recipe,
        };
      }),
    },
  };
}

export async function getItemCraftTree(options: {
  q: string;
  quantity: number;
  lang?: string;
  gameVersion?: string;
  acceptLanguage?: string;
}): Promise<{
  query: string;
  quantity: number;
  locale: string;
  item: {
    id: string;
    internalName: string;
    name: string;
    names: ItemNames;
  };
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
  if (candidates.length > 1) {
    throw new ValidationError('Ambiguous item query', {
      query: options.q,
      candidates: candidates.map((c) => ({
        id: c.id,
        internalName: c.internalName,
        name: c.name,
      })),
    });
  }

  const item = candidates[0]!;
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
    item: {
      id: root.id,
      internalName: root.internalName,
      name: root.name,
      names: root.names,
    },
    items: root.items,
    totals: collectAllTotals(root.items),
    rawTotals: collectRawTotals(root.items),
  };
}
