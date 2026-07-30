import { z } from 'zod';
import { listQuerySchema } from '../../shared/query.js';

export const palsListQuerySchema = listQuerySchema;

export const palParamsSchema = z.object({
  idOrSlug: z.string().min(1),
});
