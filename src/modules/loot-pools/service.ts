import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client.js';
import { NotFoundError } from '../../shared/errors.js';
import { pickTranslation, resolveLocale } from '../../shared/i18n.js';
import { resolveActiveGameVersionId } from '../../shared/version.js';

const RARITY_LABELS_PT: Record<number, string> = {
  0: 'Comum',
  1: 'Incomum',
  2: 'Raro',
  3: 'Épico',
  4: 'Lendário',
};

function rarityLabel(rarity: number | null | undefined): string | null {
  if (rarity == null || !(rarity in RARITY_LABELS_PT)) return null;
  return RARITY_LABELS_PT[rarity] ?? null;
}

type LootSource = {
  type: string;
  pool: string;
  grade?: string | null;
  weight?: number | null;
  chance?: number | null;
  slotChance?: number | null;
  quantityMin: number;
  quantityMax: number;
};

type ItemNames = { en: string; 'pt-BR': string };

function asLootSources(value: unknown): LootSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is LootSource =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as LootSource).pool === 'string',
  );
}

function rarityVariantBase(internalName: string): string {
  const m = internalName.match(/^(.*)_\d+$/);
  return m?.[1] ?? internalName;
}

export async function getLootPoolDetail(options: {
  poolId: string;
  lang?: string;
  gameVersion?: string;
  acceptLanguage?: string;
}) {
  const gameVersionId = await resolveActiveGameVersionId(options.gameVersion);
  const locale = resolveLocale(
    { headers: { 'accept-language': options.acceptLanguage ?? '' } } as never,
    options.lang,
  );
  const poolId = options.poolId.trim();
  if (!poolId) throw new NotFoundError('Loot pool not found');

  const items = await prisma.item.findMany({
    where: {
      gameVersionId,
      lootSources: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      internalName: true,
      name: true,
      description: true,
      iconUrl: true,
      rarity: true,
      lootSources: true,
    },
  });

  const drops: Array<{
    item: {
      id: string;
      internalName: string;
      name: string;
      names: ItemNames;
      description: string | null;
      iconUrl: string | null;
      rarity: number | null;
      rarityLabel: string | null;
      groupKey: string;
    };
    grade: string | null;
    chance: number | null;
    quantityMin: number;
    quantityMax: number;
  }> = [];

  const grades = new Set<string>();

  for (const row of items) {
    const sources = asLootSources(row.lootSources);
    for (const src of sources) {
      if (src.pool !== poolId) continue;
      if (src.grade) grades.add(src.grade);
      drops.push({
        item: {
          id: row.id,
          internalName: row.internalName,
          name: row.name,
          names: { en: row.name, 'pt-BR': row.name },
          description: row.description,
          iconUrl: row.iconUrl,
          rarity: row.rarity,
          rarityLabel: rarityLabel(row.rarity),
          groupKey: rarityVariantBase(row.internalName),
        },
        grade: src.grade ?? null,
        chance: src.chance ?? null,
        quantityMin: src.quantityMin,
        quantityMax: src.quantityMax,
      });
    }
  }

  if (drops.length === 0) {
    throw new NotFoundError(`Loot pool not found: ${poolId}`);
  }

  // Localize names for dropped items
  const ids = [...new Set(drops.map((d) => d.item.id))];
  const translations = await prisma.translation.findMany({
    where: {
      gameVersionId,
      entityType: 'item',
      field: { in: ['name', 'description'] },
      entityId: { in: ids },
    },
    select: { entityId: true, locale: true, field: true, value: true },
  });
  const byEntity = new Map<string, typeof translations>();
  for (const t of translations) {
    const list = byEntity.get(t.entityId) ?? [];
    list.push(t);
    byEntity.set(t.entityId, list);
  }

  for (const drop of drops) {
    const forItem = (byEntity.get(drop.item.id) ?? []).map((t) => ({
      locale: t.locale,
      field: t.field,
      value: t.value,
    }));
    drop.item.names = {
      en: pickTranslation(forItem, 'name', 'en', drop.item.name) ?? drop.item.name,
      'pt-BR':
        pickTranslation(forItem, 'name', 'pt-BR', drop.item.name) ??
        drop.item.name,
    };
    drop.item.name =
      pickTranslation(forItem, 'name', locale, drop.item.name) ?? drop.item.name;
    drop.item.description =
      pickTranslation(
        forItem,
        'description',
        locale,
        drop.item.description,
      ) ?? drop.item.description;
  }

  drops.sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0));

  // Related consumable (TreasureMap05 item) when pool is a treasure map
  let relatedItem: {
    id: string;
    internalName: string;
    name: string;
    names: ItemNames;
    description: string | null;
    iconUrl: string | null;
    rarity: number | null;
    rarityLabel: string | null;
    groupKey: string;
    lootSources: LootSource[];
  } | null = null;

  if (/^TreasureMap\d+$/i.test(poolId)) {
    const mapItem = await prisma.item.findFirst({
      where: { gameVersionId, internalName: poolId },
    });
    if (mapItem) {
      const tr = await prisma.translation.findMany({
        where: {
          gameVersionId,
          entityType: 'item',
          entityId: mapItem.id,
          field: { in: ['name', 'description'] },
        },
        select: { locale: true, field: true, value: true },
      });
      const names: ItemNames = {
        en: pickTranslation(tr, 'name', 'en', mapItem.name) ?? mapItem.name,
        'pt-BR':
          pickTranslation(tr, 'name', 'pt-BR', mapItem.name) ?? mapItem.name,
      };
      relatedItem = {
        id: mapItem.id,
        internalName: mapItem.internalName,
        name:
          pickTranslation(tr, 'name', locale, mapItem.name) ?? mapItem.name,
        names,
        description:
          pickTranslation(tr, 'description', locale, mapItem.description) ??
          mapItem.description,
        iconUrl: mapItem.iconUrl,
        rarity: mapItem.rarity,
        rarityLabel: rarityLabel(mapItem.rarity),
        groupKey: rarityVariantBase(mapItem.internalName),
        lootSources: asLootSources(mapItem.lootSources),
      };
    }
  }

  return {
    locale,
    pool: poolId,
    grades: [...grades].sort(),
    relatedItem,
    drops,
    totalItems: drops.length,
  };
}
