import type { GameDump } from '../../src/parser/game-dump.js';
import {
  asNumber,
  asString,
  extractLocalizedText,
  loadLocaleNamedDataTable,
  loadNamedDataTable,
  stripEnumPrefix,
  type DataTableRows,
} from './datatable.js';
import type { SteamGameInfo } from './steam.js';

const WORK_MAP: Array<{ key: string; type: string }> = [
  { key: 'WorkSuitability_EmitFlame', type: 'Kindling' },
  { key: 'WorkSuitability_Watering', type: 'Watering' },
  { key: 'WorkSuitability_Seeding', type: 'Planting' },
  { key: 'WorkSuitability_GenerateElectricity', type: 'Electricity' },
  { key: 'WorkSuitability_Handcraft', type: 'Handiwork' },
  { key: 'WorkSuitability_Collection', type: 'Gathering' },
  { key: 'WorkSuitability_Deforest', type: 'Lumbering' },
  { key: 'WorkSuitability_Mining', type: 'Mining' },
  { key: 'WorkSuitability_OilExtraction', type: 'OilExtraction' },
  { key: 'WorkSuitability_ProductMedicine', type: 'Medicine' },
  { key: 'WorkSuitability_Cool', type: 'Cooling' },
  { key: 'WorkSuitability_Transport', type: 'Transporting' },
  { key: 'WorkSuitability_MonsterFarm', type: 'Farming' },
];

const ELEMENT_PREFIXES = ['EPalElementType::', 'PalElementType::', 'ElementType::'];
const SIZE_PREFIXES = ['EPalSizeType::', 'PalSizeType::'];

function textFromL10n(
  rows: DataTableRows | null,
  key: string | null,
): string | null {
  if (!rows || !key) return null;
  const direct = rows[key];
  if (direct) {
    return extractLocalizedText(direct);
  }
  for (const [rowKey, row] of Object.entries(rows)) {
    if (rowKey === key || rowKey.endsWith(key)) {
      return extractLocalizedText(row);
    }
  }
  return null;
}

function isUsableLocalizedText(value: string | null | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  if (!v || v === '-' || v === 'None') return false;
  // Incomplete FModel L10N stubs like "pt-BR_Text" / "en_Text"
  if (/^[a-z]{2}(-[A-Za-z]{2})?_Text$/i.test(v)) return false;
  return true;
}

function pushItemNameTranslation(
  translations: GameDump['translations'],
  internalName: string,
  locale: string,
  value: string | null | undefined,
): void {
  if (!isUsableLocalizedText(value)) return;
  const exists = translations.some(
    (t) =>
      t.entityType === 'item' &&
      t.entityInternalName === internalName &&
      t.locale === locale &&
      t.field === 'name',
  );
  if (exists) return;
  translations.push({
    entityType: 'item',
    entityInternalName: internalName,
    locale,
    field: 'name',
    value: value.trim(),
  });
}

function isProbablyHumanPal(rowName: string, row: Record<string, unknown>): boolean {
  const lower = rowName.toLowerCase();
  if (row.IsPal === false) return false;
  if (lower.startsWith('gp_')) return false;
  if (lower.startsWith('raid_')) return false;
  if (lower.startsWith('boss_')) return false;
  if (lower.startsWith('quest_')) return false;
  if (lower.includes('human')) return false;
  const zukan = asNumber(row.ZukanIndex);
  // Negative zukan often = non-paldex entries / unused
  if (zukan == null || zukan < 0) return false;
  return true;
}

export type ConvertResult = {
  dump: GameDump;
  sources: string[];
  warnings: string[];
};

export async function convertExportsToPalaiDump(options: {
  exportDirs: string[];
  game?: SteamGameInfo | null;
  version?: string;
  build?: string;
}): Promise<ConvertResult> {
  const sources: string[] = [];
  const warnings: string[] = [];

  const monster = await loadNamedDataTable(options.exportDirs, [
    'DT_PalMonsterParameter',
  ]);
  if (!monster) {
    throw new Error(
      [
        'DT_PalMonsterParameter.json não encontrado nos exports.',
        'Exporte as DataTables com o FModel para game_data/fmodel (veja game_data/EXPORT_INSTRUCTIONS.md).',
        `Pastas pesquisadas: ${options.exportDirs.join(', ') || '(nenhuma)'}`,
      ].join('\n'),
    );
  }
  sources.push(monster.filePath);

  const waza = await loadNamedDataTable(options.exportDirs, ['DT_WazaDataTable']);
  if (waza) sources.push(waza.filePath);

  const passives = await loadNamedDataTable(options.exportDirs, [
    'DT_PassiveSkill_Main',
    'DT_PalPassiveSkill',
    'DT_PassiveSkill',
  ]);
  if (passives) sources.push(passives.filePath);

  const drops = await loadNamedDataTable(options.exportDirs, ['DT_PalDropItem']);
  if (drops) sources.push(drops.filePath);

  const items = await loadNamedDataTable(options.exportDirs, [
    'DT_ItemDataTable',
    'DT_Item',
    'DT_PalItemShopCreateDataTable',
  ]);
  if (items) sources.push(items.filePath);

  const names = await loadNamedDataTable(options.exportDirs, [
    'DT_PalNameText',
    'DT_PalNameTextDataTable',
    'DT_UI_Common_Text',
  ]);
  if (names) sources.push(names.filePath);

  const descs = await loadNamedDataTable(options.exportDirs, [
    'DT_PalLongDescriptionText',
    'DT_PalDescriptionText',
  ]);
  if (descs) sources.push(descs.filePath);

  const skillNames = await loadNamedDataTable(options.exportDirs, [
    'DT_SkillNameText',
    'DT_SkillNameText_Common',
    'DT_WazaNameText',
  ]);
  if (skillNames) sources.push(skillNames.filePath);

  const skillDescs = await loadNamedDataTable(options.exportDirs, [
    'DT_SkillDescText',
    'DT_SkillDescText_Common',
  ]);
  if (skillDescs) sources.push(skillDescs.filePath);

  const breeding = await loadNamedDataTable(options.exportDirs, [
    'DT_PalCombi',
    'DT_PalBreeding',
    'DT_PalCombiUnique',
  ]);
  if (breeding) sources.push(breeding.filePath);

  const recipesTable = await loadNamedDataTable(options.exportDirs, [
    'DT_ItemRecipeDataTable',
  ]);
  if (recipesTable) sources.push(recipesTable.filePath);

  const technologiesTable = await loadNamedDataTable(options.exportDirs, [
    'DT_TechnologyRecipeUnlock',
  ]);
  if (technologiesTable) sources.push(technologiesTable.filePath);

  const techNames = await loadNamedDataTable(options.exportDirs, [
    'DT_TechnologyNameText',
  ]);
  if (techNames) sources.push(techNames.filePath);

  const techDescs = await loadNamedDataTable(options.exportDirs, [
    'DT_TechnologyDescText',
  ]);
  if (techDescs) sources.push(techDescs.filePath);

  const itemNames = await loadNamedDataTable(options.exportDirs, [
    'DT_ItemNameText',
  ]);
  if (itemNames) sources.push(itemNames.filePath);

  const itemNamesEn = await loadLocaleNamedDataTable(options.exportDirs, 'en', [
    'DT_ItemNameText',
  ]);
  if (itemNamesEn) sources.push(itemNamesEn.filePath);

  const itemNamesPt = await loadLocaleNamedDataTable(
    options.exportDirs,
    'pt-BR',
    ['DT_ItemNameText'],
  );
  if (itemNamesPt) sources.push(itemNamesPt.filePath);

  const itemDescs = await loadNamedDataTable(options.exportDirs, [
    'DT_ItemDescriptionText',
  ]);
  if (itemDescs) sources.push(itemDescs.filePath);

  const worldAreas = await loadNamedDataTable(options.exportDirs, [
    'DT_WorldMapAreaData',
  ]);
  if (worldAreas) sources.push(worldAreas.filePath);

  const worldAreaText = await loadNamedDataTable(options.exportDirs, [
    'DT_WorldMap_Common_Text',
  ]);
  if (worldAreaText) sources.push(worldAreaText.filePath);

  const dungeonAreas = await loadNamedDataTable(options.exportDirs, [
    'DT_DungeonSpawnAreaDataTable',
  ]);
  if (dungeonAreas) sources.push(dungeonAreas.filePath);

  const dungeonLevels = await loadNamedDataTable(options.exportDirs, [
    'DT_DungeonLevelDataTable',
  ]);
  if (dungeonLevels) sources.push(dungeonLevels.filePath);

  const dungeonNames = await loadNamedDataTable(options.exportDirs, [
    'DT_DungeonNameText',
  ]);
  if (dungeonNames) sources.push(dungeonNames.filePath);

  const wildSpawners = await loadNamedDataTable(options.exportDirs, [
    'DT_PalWildSpawner',
  ]);
  if (wildSpawners) sources.push(wildSpawners.filePath);

  const spawnerPlacement = await loadNamedDataTable(options.exportDirs, [
    'DT_PalSpawnerPlacement',
  ]);
  if (spawnerPlacement) sources.push(spawnerPlacement.filePath);

  const elementSet = new Map<string, string>();
  const pals: GameDump['pals'] = [];
  const skills: GameDump['skills'] = [];
  const passiveSkills: GameDump['passives'] = [];
  const itemList: GameDump['items'] = [];
  const recipes: GameDump['recipes'] = [];
  const technologies: GameDump['technologies'] = [];
  const locations: GameDump['locations'] = [];
  const dungeons: GameDump['dungeons'] = [];
  const bosses: GameDump['bosses'] = [];
  const dropListLinked = new Map<string, GameDump['pals'][number]['drops']>();
  const translations: GameDump['translations'] = [];
  const breedingOverrides: GameDump['breedingOverrides'] = [];
  const locationIds = new Set<string>();

  // Skills
  if (waza) {
    for (const [rowName, row] of Object.entries(waza.rows)) {
      const element =
        stripEnumPrefix(asString(row.Element) ?? asString(row.ElementType), ELEMENT_PREFIXES) ??
        null;
      if (element) elementSet.set(element, element);
      const name =
        textFromL10n(skillNames?.rows ?? null, asString(row.WazaNameTextId) ?? rowName) ??
        rowName;
      const description =
        textFromL10n(
          skillDescs?.rows ?? null,
          asString(row.WazaDescTextId) ?? asString(row.DescriptionTextId),
        ) ?? null;

      skills.push({
        internalName: rowName,
        name,
        description,
        power: asNumber(row.Power) ?? asNumber(row.BaseDamage),
        cooldown: asNumber(row.CoolTime) ?? asNumber(row.Cooldown),
        range: asNumber(row.MinRange) ?? asNumber(row.Range),
        element,
        category: 'ACTIVE',
      });
    }
  } else {
    warnings.push('DT_WazaDataTable não encontrado — skills ativos ficarão vazios.');
  }

  // Passives
  if (passives) {
    for (const [rowName, row] of Object.entries(passives.rows)) {
      passiveSkills.push({
        internalName: rowName,
        name:
          textFromL10n(names?.rows ?? null, asString(row.PassiveSkillNameTextId)) ??
          asString(row.OverrideName) ??
          rowName,
        description:
          textFromL10n(descs?.rows ?? null, asString(row.PassiveSkillDescTextId)) ??
          null,
        rarity: asNumber(row.Rarity),
        modifiers: row.Effects && typeof row.Effects === 'object'
          ? (row.Effects as Record<string, unknown>)
          : null,
      });
    }
  } else {
    warnings.push('Tabela de passives não encontrada.');
  }

  // Items (best-effort) — prefer EN display name; keep EN/PT translations for search
  if (items) {
    for (const [rowName, row] of Object.entries(items.rows)) {
      const price = asNumber(row.Price);
      const nameKey = `ITEM_NAME_${rowName}`;
      const enName = textFromL10n(itemNamesEn?.rows ?? null, nameKey);
      const ptName = textFromL10n(itemNamesPt?.rows ?? null, nameKey);
      const fallbackName =
        textFromL10n(itemNames?.rows ?? null, nameKey) ??
        textFromL10n(
          names?.rows ?? null,
          asString(row.ItemNameTextId) ?? asString(row.NameTextId),
        ) ??
        asString(row.OverrideName) ??
        rowName;
      const displayName = isUsableLocalizedText(enName)
        ? enName.trim()
        : isUsableLocalizedText(fallbackName)
          ? fallbackName.trim()
          : rowName;

      itemList.push({
        internalName: rowName,
        name: displayName,
        description:
          textFromL10n(itemDescs?.rows ?? null, `ITEM_DESC_${rowName}`) ??
          textFromL10n(
            descs?.rows ?? null,
            asString(row.ItemDescriptionTextId) ?? asString(row.DescriptionTextId),
          ) ??
          asString(row.OverrideDescription) ??
          null,
        icon: asString(row.IconName) ?? asString(row.Icon),
        rarity: asNumber(row.Rarity) != null ? Math.round(asNumber(row.Rarity)!) : null,
        weight: asNumber(row.Weight),
        price: price != null ? Math.round(price) : null,
        stackSize:
          asNumber(row.MaxStackCount) != null
            ? Math.round(asNumber(row.MaxStackCount)!)
            : asNumber(row.Stack) != null
              ? Math.round(asNumber(row.Stack)!)
              : null,
      });

      pushItemNameTranslation(translations, rowName, 'en', enName ?? displayName);
      pushItemNameTranslation(translations, rowName, 'pt-BR', ptName);
    }
  }

  // Drops: DT_PalDropItem uses CharacterID + ItemId1..10 / RateN / minN / MaxN
  if (drops) {
    for (const row of Object.values(drops.rows)) {
      const palId = asString(row.CharacterID) ?? asString(row.CharacterId);
      if (!palId || palId === 'None') continue;

      const list = dropListLinked.get(palId) ?? [];
      for (let i = 1; i <= 10; i++) {
        const item = asString(row[`ItemId${i}`]);
        if (!item || item === 'None') continue;
        const chance = asNumber(row[`Rate${i}`]);
        const quantityMin = asNumber(row[`min${i}`]) ?? asNumber(row[`Min${i}`]) ?? 1;
        const quantityMax = asNumber(row[`Max${i}`]) ?? quantityMin;
        const exists = list.some(
          (d) =>
            d.item === item &&
            d.chance === chance &&
            d.quantityMin === quantityMin &&
            d.quantityMax === quantityMax,
        );
        if (exists) continue;
        list.push({
          item,
          chance: chance != null ? chance / 100 : null,
          quantityMin: Math.round(quantityMin),
          quantityMax: Math.round(quantityMax),
        });
        if (!itemList.some((it) => it.internalName === item)) {
          itemList.push({
            internalName: item,
            name:
              textFromL10n(itemNames?.rows ?? null, `ITEM_NAME_${item}`) ?? item,
            description: null,
            icon: null,
            rarity: null,
            weight: null,
            price: null,
            stackSize: null,
          });
        }
      }
      dropListLinked.set(palId, list);
    }
  }

  // Pals
  for (const [rowName, row] of Object.entries(monster.rows)) {
    if (!isProbablyHumanPal(rowName, row)) continue;

    const el1 = stripEnumPrefix(asString(row.ElementType1), ELEMENT_PREFIXES);
    const el2 = stripEnumPrefix(asString(row.ElementType2), ELEMENT_PREFIXES);
    const elements = [el1, el2].filter((e): e is string => Boolean(e) && e !== 'None');
    for (const el of elements) elementSet.set(el, el);

    const workSuitabilities = WORK_MAP.map(({ key, type }) => {
      const level = asNumber(row[key]) ?? 0;
      return level > 0 ? { type, level } : null;
    }).filter((v): v is { type: string; level: number } => v != null);

    const displayName =
      textFromL10n(names?.rows ?? null, asString(row.OverrideNameTextID) ?? rowName) ??
      textFromL10n(names?.rows ?? null, `PAL_NAME_${rowName}`) ??
      rowName;

    const description =
      textFromL10n(descs?.rows ?? null, asString(row.LongDescriptionTextID)) ??
      textFromL10n(descs?.rows ?? null, `PAL_DESC_${rowName}`) ??
      null;

    const partnerSkill = asString(row.PassiveSkillName) ?? asString(row.PartnerSkillName);
    const activeSkills: string[] = [];
    // Some rows embed skill lists; capture string arrays if present
    for (const [k, v] of Object.entries(row)) {
      if (/waza|skill/i.test(k) && Array.isArray(v)) {
        for (const entry of v) {
          const id = asString(entry);
          if (id) activeSkills.push(id);
        }
      }
    }

    const palDrops =
      dropListLinked.get(rowName) ??
      dropListLinked.get(asString(row.Tribe) ?? '') ??
      [];

    pals.push({
      internalName: rowName,
      paldexNumber: asNumber(row.ZukanIndex),
      name: displayName,
      description,
      rarity: asNumber(row.Rarity),
      size: stripEnumPrefix(asString(row.Size), SIZE_PREFIXES),
      price: asNumber(row.Price),
      hp: asNumber(row.Hp),
      attack: asNumber(row.ShotAttack) ?? asNumber(row.MeleeAttack),
      defense: asNumber(row.Defense),
      stamina: asNumber(row.Support),
      hunger: asNumber(row.MaxFullStomach),
      movementSpeed: asNumber(row.WalkSpeed) ?? asNumber(row.SlowWalkSpeed),
      sprintSpeed: asNumber(row.RunSpeed),
      rideSpeed: asNumber(row.RideSprintSpeed),
      genderRatio: asNumber(row.MaleProbability) != null
        ? (asNumber(row.MaleProbability) as number) / 100
        : null,
      captureRate: asNumber(row.CaptureRateCorrect),
      breedingPower:
        asNumber(row.CombiRank) ??
        asNumber(row.Combi_ID) ??
        asNumber(row.BreedingPower),
      elements,
      partnerSkill,
      passiveSkills: [],
      activeSkills: [...new Set(activeSkills)],
      workSuitabilities,
      drops: palDrops,
      habitats: [],
      icon: null,
    });

    if (displayName !== rowName) {
      translations.push({
        entityType: 'pal',
        entityInternalName: rowName,
        locale: 'en',
        field: 'name',
        value: displayName,
      });
    }
    if (description) {
      translations.push({
        entityType: 'pal',
        entityInternalName: rowName,
        locale: 'en',
        field: 'description',
        value: description,
      });
    }
  }

  if (breeding) {
    for (const [, row] of Object.entries(breeding.rows)) {
      const parentA = stripEnumPrefix(
        asString(row.ParentTribeA) ??
          asString(row.parentTribeA) ??
          asString(row.ParentA),
        ['EPalTribeID::', 'PalTribeID::'],
      );
      const parentB = stripEnumPrefix(
        asString(row.ParentTribeB) ??
          asString(row.parentTribeB) ??
          asString(row.ParentB),
        ['EPalTribeID::', 'PalTribeID::'],
      );
      const child =
        asString(row.ChildCharacterID) ??
        asString(row.ChildCharacterId) ??
        asString(row.childCharacterId) ??
        asString(row.Child);
      if (parentA && parentB && child) {
        breedingOverrides.push({ parentA, parentB, child });
      }
    }
  }

  // Recipes
  if (recipesTable) {
    for (const [rowName, row] of Object.entries(recipesTable.rows)) {
      const result = asString(row.Product_Id);
      if (!result || result === 'None') continue;
      const ingredients: Array<{ item: string; quantity: number }> = [];
      for (let i = 1; i <= 5; i++) {
        const item = asString(row[`Material${i}_Id`]);
        const quantity = asNumber(row[`Material${i}_Count`]) ?? 0;
        if (!item || item === 'None' || quantity <= 0) continue;
        ingredients.push({ item, quantity: Math.round(quantity) });
      }
      const workAmount = asNumber(row.WorkAmount);
      recipes.push({
        internalName: rowName,
        craftingStation: null,
        craftTime: workAmount != null ? workAmount / 1000 : null,
        result,
        resultQuantity: Math.round(asNumber(row.Product_Count) ?? 1),
        ingredients,
      });
    }
  } else {
    warnings.push('DT_ItemRecipeDataTable não encontrado — recipes ficarão vazios.');
  }

  // Technologies
  if (technologiesTable) {
    for (const [rowName, row] of Object.entries(technologiesTable.rows)) {
      const unlockItems = Array.isArray(row.UnlockItemRecipes)
        ? row.UnlockItemRecipes.map((v) => asString(v)).filter(Boolean)
        : [];
      const unlockBuilds = Array.isArray(row.UnlockBuildObjects)
        ? row.UnlockBuildObjects.map((v) => asString(v)).filter(Boolean)
        : [];
      const linkedItem =
        (unlockItems[0] as string | undefined) ??
        (unlockBuilds[0] as string | undefined) ??
        null;
      technologies.push({
        internalName: rowName,
        name:
          textFromL10n(techNames?.rows ?? null, asString(row.Name)) ??
          asString(row.Name) ??
          rowName,
        description:
          textFromL10n(techDescs?.rows ?? null, asString(row.Description)) ??
          asString(row.Description) ??
          null,
        level:
          asNumber(row.LevelCap) != null ? Math.round(asNumber(row.LevelCap)!) : null,
        unlockCost:
          asNumber(row.Cost) != null ? Math.round(asNumber(row.Cost)!) : null,
        item: linkedItem,
      });
    }
  } else {
    warnings.push('DT_TechnologyRecipeUnlock não encontrado — technologies ficarão vazios.');
  }

  // Locations (world map regions)
  if (worldAreas) {
    for (const [rowName, row] of Object.entries(worldAreas.rows)) {
      const msgId = asString(row.MsgID);
      const name =
        textFromL10n(worldAreaText?.rows ?? null, msgId) ??
        msgId ??
        rowName;
      locations.push({
        internalName: rowName,
        name,
        biome: rowName.replace(/\d+$/, '').replace(/_+$/, '') || rowName,
        coordinates: null,
        level: null,
      });
      locationIds.add(rowName);
    }
  } else {
    warnings.push('DT_WorldMapAreaData não encontrado — locations ficarão vazios.');
  }

  // Placement lookup for boss coords / respawn
  const placementBySpawner = new Map<
    string,
    { x?: number; y?: number; z?: number; respawnTime?: number | null }
  >();
  if (spawnerPlacement) {
    for (const row of Object.values(spawnerPlacement.rows)) {
      const spawnerName = asString(row.SpawnerName);
      if (!spawnerName) continue;
      const loc =
        row.Location && typeof row.Location === 'object'
          ? (row.Location as Record<string, unknown>)
          : null;
      placementBySpawner.set(spawnerName, {
        x: asNumber(loc?.X) ?? undefined,
        y: asNumber(loc?.Y) ?? undefined,
        z: asNumber(loc?.Z) ?? undefined,
        respawnTime:
          asNumber(row.RespawnCoolTime) != null
            ? Math.round(asNumber(row.RespawnCoolTime)!)
            : null,
      });
    }
  }

  // Dungeons
  const dungeonLevelRange = new Map<string, { min: number; max: number }>();
  if (dungeonLevels) {
    for (const row of Object.values(dungeonLevels.rows)) {
      const areaId = asString(row.SpawnAreaId);
      if (!areaId) continue;
      // Level rows don't always include enemy level; keep placeholder range by presence
      const current = dungeonLevelRange.get(areaId) ?? { min: 1, max: 1 };
      dungeonLevelRange.set(areaId, current);
    }
  }
  if (dungeonAreas) {
    for (const [rowName, row] of Object.entries(dungeonAreas.rows)) {
      if (rowName.toLowerCase().includes('test') || rowName.toLowerCase().includes('debug')) {
        continue;
      }
      const nameId = asString(row.DungeonNameTextId);
      const name =
        textFromL10n(dungeonNames?.rows ?? null, nameId) ??
        nameId ??
        rowName;
      const range = dungeonLevelRange.get(rowName);
      dungeons.push({
        internalName: rowName,
        name: name === '-' ? rowName : name,
        biome: null,
        minimumLevel: range?.min ?? null,
        maximumLevel: range?.max ?? null,
        location: null,
      });
    }
  } else {
    warnings.push('DT_DungeonSpawnAreaDataTable não encontrado — dungeons ficarão vazios.');
  }

  // Bosses from wild spawners
  const palInternalNames = new Set(pals.map((p) => p.internalName));
  if (wildSpawners) {
    for (const [rowName, row] of Object.entries(wildSpawners.rows)) {
      const spawnerType = asString(row.SpawnerType) ?? '';
      const palRaw = asString(row.Pal_1);
      const isBoss =
        spawnerType.includes('Boss') ||
        (palRaw?.startsWith('BOSS_') ?? false) ||
        (palRaw?.startsWith('Boss_') ?? false);
      if (!isBoss || !palRaw || palRaw === 'None') continue;

      const spawnerName = asString(row.SpawnerName) ?? rowName;
      const placement = placementBySpawner.get(spawnerName);
      if (placement && !locationIds.has(spawnerName)) {
        locations.push({
          internalName: spawnerName,
          name: spawnerName,
          biome: null,
          coordinates: {
            x: placement.x,
            y: placement.y,
            z: placement.z,
          },
          level:
            asNumber(row.LvMin_1) != null ? Math.round(asNumber(row.LvMin_1)!) : null,
        });
        locationIds.add(spawnerName);
      }

      const basePal = palRaw.replace(/^BOSS_/i, '').replace(/^Boss_/i, '');
      const linkedPal = palInternalNames.has(basePal)
        ? basePal
        : palInternalNames.has(palRaw)
          ? palRaw
          : basePal;

      bosses.push({
        internalName: rowName,
        level:
          asNumber(row.LvMin_1) != null ? Math.round(asNumber(row.LvMin_1)!) : null,
        respawnTime: placement?.respawnTime ?? null,
        pal: linkedPal,
        location: locationIds.has(spawnerName) ? spawnerName : null,
        dungeon: null,
      });
    }
  } else {
    warnings.push('DT_PalWildSpawner não encontrado — bosses ficarão vazios.');
  }

  if (pals.length === 0) {
    throw new Error(
      'Nenhum Pal válido encontrado em DT_PalMonsterParameter. Verifique o export do FModel.',
    );
  }

  const dump: GameDump = {
    version: options.version ?? 'palworld',
    build: options.build ?? options.game?.buildId ?? '',
    releaseDate: new Date().toISOString(),
    elements: [...elementSet.keys()].sort().map((name) => ({
      internalName: name,
      name,
      icon: null,
    })),
    skills,
    passives: passiveSkills,
    items: itemList,
    pals,
    recipes,
    technologies,
    locations,
    dungeons,
    bosses,
    breedingOverrides,
    translations,
  };

  return { dump, sources, warnings };
}
