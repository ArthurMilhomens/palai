import {
  cacheGet,
  cacheKey,
  cacheSet,
} from '../../shared/cache.js';
import { pickTranslation, resolveLocale } from '../../shared/i18n.js';
import { env } from '../../config/env.js';
import { toPublicAssetUrl } from '../../shared/storage.js';
import { WORK_ICON_FILE, workIconStorageKey } from '../../shared/work-icons.js';
import { prisma } from '../../prisma/client.js';
import type { ListQuery } from '../../shared/query.js';
import { palsRepository } from './repository.js';

type WorkRow = {
  palId: string;
  workSuitabilityId: string;
  workSuitability: {
    id: string;
    internalName: string;
    type: string;
    level: number;
  };
};

type PalListRow = Awaited<
  ReturnType<typeof palsRepository.list>
>['data'][number];

async function loadWorkIconUrls(
  gameVersionId: string,
): Promise<Map<string, string>> {
  const versionRow = await prisma.gameVersion.findUnique({
    where: { id: gameVersionId },
    select: { version: true },
  });
  const versionSlug = versionRow?.version || 'palworld';
  const publicBase = env().S3_PUBLIC_URL.replace(/\/$/, '');
  const map = new Map<string, string>();
  for (const [type, file] of Object.entries(WORK_ICON_FILE)) {
    const stored = `${publicBase}/${workIconStorageKey(versionSlug, file)}`;
    const url = toPublicAssetUrl(stored);
    if (url) map.set(type, url);
  }
  return map;
}

function looksMostlyCjk(value: string): boolean {
  const letters = value.replace(/\s+/g, '');
  if (!letters) return false;
  const cjk = (letters.match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
  return cjk / letters.length > 0.4;
}

function preferReadableName(
  preferred: string | null | undefined,
  ...fallbacks: Array<string | null | undefined>
): string {
  const candidates = [preferred, ...fallbacks].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  const latin = candidates.find((v) => !looksMostlyCjk(v));
  return latin ?? candidates[0] ?? '';
}

function localizePalList(
  pals: PalListRow[],
  translations: Array<{
    entityId: string;
    locale: string;
    field: string;
    value: string;
  }>,
  locale: string,
  workIcons: Map<string, string>,
) {
  const byEntity = new Map<string, typeof translations>();
  for (const t of translations) {
    const list = byEntity.get(t.entityId) ?? [];
    list.push(t);
    byEntity.set(t.entityId, list);
  }

  return pals.map((pal) => {
    const forPal = byEntity.get(pal.id) ?? [];
    const en =
      pickTranslation(forPal, 'name', 'en', pal.name) ?? pal.name;
    const pt =
      pickTranslation(forPal, 'name', 'pt-BR', pal.name) ?? pal.name;
    const localized =
      pickTranslation(forPal, 'name', locale, pal.name) ?? pal.name;
    const name = preferReadableName(localized, pt, en, pal.internalName);
    const names = {
      en: preferReadableName(en, pt, pal.internalName),
      'pt-BR': preferReadableName(pt, en, pal.internalName),
    };
    const workSuitabilities = (pal.workSuitabilities as WorkRow[])
      .map((w) => ({
        type: w.workSuitability.type,
        internalName: w.workSuitability.internalName,
        level: w.workSuitability.level,
        iconUrl: workIcons.get(w.workSuitability.type) ?? null,
      }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.level - b.level);

    return {
      id: pal.id,
      internalName: pal.internalName,
      paldexNumber: pal.paldexNumber,
      name,
      names,
      iconUrl: pal.iconUrl,
      rarity: pal.rarity,
      elements: pal.elements.map((e) => ({
        internalName: e.element.internalName,
        name: e.element.name,
      })),
      workSuitabilities,
    };
  });
}

type PalDetailRow = Awaited<ReturnType<typeof palsRepository.findByIdOrSlug>>;

type TranslationRow = {
  locale: string;
  field: string;
  value: string;
};

type ItemTranslationRow = TranslationRow & { entityId: string };

function miniPal(p: {
  id: string;
  internalName: string;
  name: string;
  iconUrl: string | null;
  paldexNumber: number | null;
}) {
  return {
    id: p.id,
    internalName: p.internalName,
    name: preferReadableName(p.name, p.internalName),
    iconUrl: p.iconUrl,
    paldexNumber: p.paldexNumber,
  };
}

function shapePalDetail(
  pal: PalDetailRow,
  translations: TranslationRow[],
  itemTranslations: ItemTranslationRow[],
  locale: string,
  workIcons: Map<string, string>,
) {
  const enName =
    pickTranslation(translations, 'name', 'en', pal.name) ?? pal.name;
  const ptName =
    pickTranslation(translations, 'name', 'pt-BR', pal.name) ?? pal.name;
  const localizedName =
    pickTranslation(translations, 'name', locale, pal.name) ?? pal.name;
  const name = preferReadableName(
    localizedName,
    ptName,
    enName,
    pal.internalName,
  );
  const names = {
    en: preferReadableName(enName, ptName, pal.internalName),
    'pt-BR': preferReadableName(ptName, enName, pal.internalName),
  };

  const enDesc = pickTranslation(
    translations,
    'description',
    'en',
    pal.description,
  );
  const ptDesc = pickTranslation(
    translations,
    'description',
    'pt-BR',
    pal.description,
  );
  const localizedDesc = pickTranslation(
    translations,
    'description',
    locale,
    pal.description,
  );
  const description =
    preferReadableName(
      localizedDesc ?? '',
      ptDesc ?? '',
      enDesc ?? '',
      pal.description ?? '',
    ) || null;

  const itemNameById = new Map<string, ItemTranslationRow[]>();
  for (const t of itemTranslations) {
    const list = itemNameById.get(t.entityId) ?? [];
    list.push(t);
    itemNameById.set(t.entityId, list);
  }

  const workSuitabilities = pal.workSuitabilities
    .map((w) => ({
      type: w.workSuitability.type,
      internalName: w.workSuitability.internalName,
      level: w.workSuitability.level,
      iconUrl: workIcons.get(w.workSuitability.type) ?? null,
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.level - b.level);

  const skills = {
    active: pal.skills
      .filter((s) => !s.isPartner)
      .map((s) => ({
        id: s.skill.id,
        internalName: s.skill.internalName,
        name: preferReadableName(s.skill.name, s.skill.internalName),
        description: s.skill.description,
        power: s.skill.power,
        cooldown: s.skill.cooldown,
        range: s.skill.range,
        category: s.skill.category,
        level: s.level,
        element: s.skill.element
          ? {
              internalName: s.skill.element.internalName,
              name: s.skill.element.name,
            }
          : null,
      })),
    partner: pal.skills
      .filter((s) => s.isPartner)
      .map((s) => ({
        id: s.skill.id,
        internalName: s.skill.internalName,
        name: preferReadableName(s.skill.name, s.skill.internalName),
        description: s.skill.description,
        power: s.skill.power,
        cooldown: s.skill.cooldown,
        range: s.skill.range,
        category: s.skill.category,
        level: s.level,
        element: s.skill.element
          ? {
              internalName: s.skill.element.internalName,
              name: s.skill.element.name,
            }
          : null,
      })),
  };

  const passives = pal.passives.map((p) => ({
    id: p.passiveSkill.id,
    internalName: p.passiveSkill.internalName,
    name: preferReadableName(p.passiveSkill.name, p.passiveSkill.internalName),
    description: p.passiveSkill.description,
    rarity: p.passiveSkill.rarity,
    modifiers: p.passiveSkill.modifiers,
  }));

  const drops = pal.drops.map((d) => {
    const forItem = itemNameById.get(d.item.id) ?? [];
    const en =
      pickTranslation(forItem, 'name', 'en', d.item.name) ?? d.item.name;
    const pt =
      pickTranslation(forItem, 'name', 'pt-BR', d.item.name) ?? d.item.name;
    const localized =
      pickTranslation(forItem, 'name', locale, d.item.name) ?? d.item.name;
    return {
      chance: d.chance,
      quantityMin: d.quantityMin,
      quantityMax: d.quantityMax,
      item: {
        id: d.item.id,
        internalName: d.item.internalName,
        name: preferReadableName(localized, pt, en, d.item.internalName),
        names: {
          en: preferReadableName(en, pt, d.item.internalName),
          'pt-BR': preferReadableName(pt, en, d.item.internalName),
        },
        iconUrl: d.item.iconUrl,
        rarity: d.item.rarity,
        kind: d.item.kind,
      },
    };
  });

  const habitats = pal.habitats.map((h) => ({
    id: h.location.id,
    internalName: h.location.internalName,
    name: preferReadableName(h.location.name, h.location.internalName),
    biome: h.location.biome,
    level: h.location.level,
    coordX: h.location.coordX,
    coordY: h.location.coordY,
    coordZ: h.location.coordZ,
  }));

  const bosses = pal.bosses.map((b) => ({
    id: b.id,
    internalName: b.internalName,
    level: b.level,
    respawnTime: b.respawnTime,
    location: b.location
      ? {
          id: b.location.id,
          internalName: b.location.internalName,
          name: preferReadableName(b.location.name, b.location.internalName),
          biome: b.location.biome,
          level: b.location.level,
          coordX: b.location.coordX,
          coordY: b.location.coordY,
          coordZ: b.location.coordZ,
        }
      : null,
    dungeon: b.dungeon
      ? {
          id: b.dungeon.id,
          internalName: b.dungeon.internalName,
          name: preferReadableName(b.dungeon.name, b.dungeon.internalName),
          biome: b.dungeon.biome,
          minimumLevel: b.dungeon.minimumLevel,
          maximumLevel: b.dungeon.maximumLevel,
        }
      : null,
  }));

  const breedingAsChild = pal.breedingAsChild.map((row) => ({
    parentA: miniPal(row.parentA),
    parentB: miniPal(row.parentB),
  }));

  const breedingAsParent = [
    ...pal.breedingAsParentA.map((row) => ({
      partner: miniPal(row.parentB),
      child: miniPal(row.child),
    })),
    ...pal.breedingAsParentB.map((row) => ({
      partner: miniPal(row.parentA),
      child: miniPal(row.child),
    })),
  ];

  return {
    id: pal.id,
    internalName: pal.internalName,
    paldexNumber: pal.paldexNumber,
    name,
    names,
    description,
    rarity: pal.rarity,
    size: pal.size,
    price: pal.price,
    hp: pal.hp,
    attack: pal.attack,
    defense: pal.defense,
    stamina: pal.stamina,
    hunger: pal.hunger,
    movementSpeed: pal.movementSpeed,
    sprintSpeed: pal.sprintSpeed,
    rideSpeed: pal.rideSpeed,
    genderRatio: pal.genderRatio,
    captureRate: pal.captureRate,
    breedingPower: pal.breedingPower,
    iconUrl: pal.iconUrl,
    elements: pal.elements.map((e) => ({
      internalName: e.element.internalName,
      name: e.element.name,
      iconUrl: e.element.iconUrl,
    })),
    workSuitabilities,
    skills,
    passives,
    drops,
    habitats,
    bosses,
    breeding: {
      asChild: breedingAsChild,
      asParent: breedingAsParent,
    },
  };
}

export class PalsService {
  async list(query: ListQuery & { lang?: string; acceptLanguage?: string }) {
    const locale = resolveLocale(
      { headers: { 'accept-language': query.acceptLanguage ?? '' } } as never,
      query.lang,
    );
    const key = cacheKey({
      route: 'pals:list:v4',
      ...query,
      locale,
    });
    const cached = await cacheGet<{
      data: ReturnType<typeof localizePalList>;
      meta: Awaited<ReturnType<typeof palsRepository.list>>['meta'];
    }>(key);
    if (cached) return cached;

    const result = await palsRepository.list(query);
    const ids = result.data.map((p) => p.id);
    const gameVersionId = result.data[0]?.gameVersionId;

    const [translations, workIcons] = await Promise.all([
      ids.length === 0 || !gameVersionId
        ? Promise.resolve([])
        : prisma.translation.findMany({
            where: {
              gameVersionId,
              entityType: 'pal',
              field: 'name',
              entityId: { in: ids },
            },
            select: {
              entityId: true,
              locale: true,
              field: true,
              value: true,
            },
          }),
      gameVersionId
        ? loadWorkIconUrls(gameVersionId)
        : Promise.resolve(new Map<string, string>()),
    ]);

    const payload = {
      data: localizePalList(result.data, translations, locale, workIcons),
      meta: result.meta,
    };
    await cacheSet(key, payload);
    return payload;
  }

  async getByIdOrSlug(
    idOrSlug: string,
    options: { gameVersion?: string; lang?: string; acceptLanguage?: string } = {},
  ) {
    const locale = resolveLocale(
      { headers: { 'accept-language': options.acceptLanguage ?? '' } } as never,
      options.lang,
    );
    const key = cacheKey({
      route: 'pals:detail:v2',
      idOrSlug,
      gameVersion: options.gameVersion ?? null,
      locale,
    });
    const cached = await cacheGet<Awaited<ReturnType<typeof shapePalDetail>>>(
      key,
    );
    if (cached) return cached;

    const pal = await palsRepository.findByIdOrSlug(
      idOrSlug,
      options.gameVersion,
    );
    const [translations, itemTranslations, workIcons] = await Promise.all([
      prisma.translation.findMany({
        where: {
          gameVersionId: pal.gameVersionId,
          entityType: 'pal',
          entityId: pal.id,
          field: { in: ['name', 'description'] },
        },
        select: { locale: true, field: true, value: true },
      }),
      pal.drops.length === 0
        ? Promise.resolve([])
        : prisma.translation.findMany({
            where: {
              gameVersionId: pal.gameVersionId,
              entityType: 'item',
              field: 'name',
              entityId: { in: pal.drops.map((d) => d.item.id) },
            },
            select: {
              entityId: true,
              locale: true,
              field: true,
              value: true,
            },
          }),
      loadWorkIconUrls(pal.gameVersionId),
    ]);

    const payload = shapePalDetail(
      pal,
      translations,
      itemTranslations,
      locale,
      workIcons,
    );
    await cacheSet(key, payload);
    return payload;
  }

  getDrops(idOrSlug: string, gameVersion?: string) {
    return palsRepository.drops(idOrSlug, gameVersion);
  }

  getSkills(idOrSlug: string, gameVersion?: string) {
    return palsRepository.skills(idOrSlug, gameVersion);
  }

  getWork(idOrSlug: string, gameVersion?: string) {
    return palsRepository.work(idOrSlug, gameVersion);
  }

  getLocations(idOrSlug: string, gameVersion?: string) {
    return palsRepository.locations(idOrSlug, gameVersion);
  }
}

export const palsService = new PalsService();
