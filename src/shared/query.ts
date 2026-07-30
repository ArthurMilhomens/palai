import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

export const listQuerySchema = paginationQuerySchema.extend({
  lang: z.string().optional(),
  gameVersion: z.string().optional(),
  q: z.string().optional(),
  name: z.string().optional(),
  rarity: z.coerce.number().int().optional(),
  element: z.string().optional(),
  type: z.string().optional(),
  work: z.string().optional(),
  biome: z.string().optional(),
  level: z.coerce.number().int().optional(),
  drop: z.string().optional(),
  technology: z.string().optional(),
  category: z.string().optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export const idOrSlugParamsSchema = z.object({
  idOrSlug: z.string().min(1),
});

export const idParamsSchema = z.object({
  id: z.string().min(1),
});
