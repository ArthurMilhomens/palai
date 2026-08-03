import { z } from 'zod';

export const dumpPalSchema = z.object({
  internalName: z.string().min(1),
  paldexNumber: z.number().int().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  rarity: z.number().int().optional().nullable(),
  size: z.string().optional().nullable(),
  price: z.number().int().optional().nullable(),
  hp: z.number().int().optional().nullable(),
  attack: z.number().int().optional().nullable(),
  defense: z.number().int().optional().nullable(),
  stamina: z.number().int().optional().nullable(),
  hunger: z.number().int().optional().nullable(),
  movementSpeed: z.number().int().optional().nullable(),
  sprintSpeed: z.number().int().optional().nullable(),
  rideSpeed: z.number().int().optional().nullable(),
  genderRatio: z.number().optional().nullable(),
  captureRate: z.number().optional().nullable(),
  breedingPower: z.number().int().optional().nullable(),
  elements: z.array(z.string()).default([]),
  partnerSkill: z.string().optional().nullable(),
  passiveSkills: z.array(z.string()).default([]),
  activeSkills: z.array(z.string()).default([]),
  workSuitabilities: z
    .array(z.object({ type: z.string(), level: z.number().int() }))
    .default([]),
  drops: z
    .array(
      z.object({
        item: z.string(),
        chance: z.number().optional().nullable(),
        quantityMin: z.number().int().default(1),
        quantityMax: z.number().int().default(1),
      }),
    )
    .default([]),
  habitats: z.array(z.string()).default([]),
  icon: z.string().optional().nullable(),
});

export const dumpElementSchema = z.object({
  internalName: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional().nullable(),
});

export const dumpSkillSchema = z.object({
  internalName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  power: z.number().int().optional().nullable(),
  cooldown: z.number().optional().nullable(),
  range: z.number().optional().nullable(),
  element: z.string().optional().nullable(),
  category: z.enum(['ACTIVE', 'PARTNER']).default('ACTIVE'),
});

export const dumpPassiveSchema = z.object({
  internalName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  rarity: z.number().int().optional().nullable(),
  modifiers: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const dumpItemSchema = z.object({
  internalName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  rarity: z.number().int().optional().nullable(),
  weight: z.number().optional().nullable(),
  price: z.number().int().optional().nullable(),
  stackSize: z.number().int().optional().nullable(),
  lootSources: z
    .array(
      z.object({
        type: z.string(),
        pool: z.string(),
        grade: z.string().optional().nullable(),
        weight: z.number().optional().nullable(),
        chance: z.number().optional().nullable(),
        slotChance: z.number().optional().nullable(),
        quantityMin: z.number().int().default(1),
        quantityMax: z.number().int().default(1),
      }),
    )
    .default([]),
});

export const dumpRecipeSchema = z.object({
  internalName: z.string().min(1),
  craftingStation: z.string().optional().nullable(),
  craftTime: z.number().optional().nullable(),
  result: z.string().min(1),
  resultQuantity: z.number().int().default(1),
  ingredients: z.array(
    z.object({
      item: z.string(),
      quantity: z.number().int().default(1),
    }),
  ),
});

export const dumpTechnologySchema = z.object({
  internalName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  level: z.number().int().optional().nullable(),
  unlockCost: z.number().int().optional().nullable(),
  item: z.string().optional().nullable(),
});

export const dumpLocationSchema = z.object({
  internalName: z.string().min(1),
  name: z.string().min(1),
  biome: z.string().optional().nullable(),
  coordinates: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      z: z.number().optional(),
    })
    .optional()
    .nullable(),
  level: z.number().int().optional().nullable(),
});

export const dumpDungeonSchema = z.object({
  internalName: z.string().min(1),
  name: z.string().min(1),
  biome: z.string().optional().nullable(),
  minimumLevel: z.number().int().optional().nullable(),
  maximumLevel: z.number().int().optional().nullable(),
  location: z.string().optional().nullable(),
});

export const dumpBossSchema = z.object({
  internalName: z.string().min(1),
  level: z.number().int().optional().nullable(),
  respawnTime: z.number().int().optional().nullable(),
  pal: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  dungeon: z.string().optional().nullable(),
});

export const dumpBreedingOverrideSchema = z.object({
  parentA: z.string().min(1),
  parentB: z.string().min(1),
  child: z.string().min(1),
});

export const dumpTranslationSchema = z.object({
  entityType: z.string().min(1),
  entityInternalName: z.string().min(1),
  locale: z.string().min(2),
  field: z.string().min(1),
  value: z.string(),
});

export const gameDumpSchema = z.object({
  version: z.string().min(1),
  build: z.string().optional().nullable(),
  releaseDate: z.string().datetime().optional().nullable(),
  elements: z.array(dumpElementSchema).default([]),
  skills: z.array(dumpSkillSchema).default([]),
  passives: z.array(dumpPassiveSchema).default([]),
  items: z.array(dumpItemSchema).default([]),
  pals: z.array(dumpPalSchema).default([]),
  recipes: z.array(dumpRecipeSchema).default([]),
  technologies: z.array(dumpTechnologySchema).default([]),
  locations: z.array(dumpLocationSchema).default([]),
  dungeons: z.array(dumpDungeonSchema).default([]),
  bosses: z.array(dumpBossSchema).default([]),
  breedingOverrides: z.array(dumpBreedingOverrideSchema).default([]),
  translations: z.array(dumpTranslationSchema).default([]),
});

export type GameDump = z.infer<typeof gameDumpSchema>;
export type DumpPal = z.infer<typeof dumpPalSchema>;

export function parseGameDump(raw: unknown): GameDump {
  return gameDumpSchema.parse(raw);
}

export function validateGameDump(raw: unknown): {
  success: boolean;
  data?: GameDump;
  errors?: z.ZodIssue[];
} {
  const result = gameDumpSchema.safeParse(raw);
  if (!result.success) {
    return { success: false, errors: result.error.issues };
  }
  return { success: true, data: result.data };
}
