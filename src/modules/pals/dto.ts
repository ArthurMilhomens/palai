import { z } from 'zod';

export const palSummaryDto = z.object({
  id: z.string(),
  internalName: z.string(),
  paldexNumber: z.number().nullable().optional(),
  name: z.string(),
  rarity: z.number().nullable().optional(),
  breedingPower: z.number().nullable().optional(),
  iconUrl: z.string().nullable().optional(),
});

export type PalSummaryDto = z.infer<typeof palSummaryDto>;
