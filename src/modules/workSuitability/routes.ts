import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const workSuitabilityModule = createEntityModule({
  name: 'WorkSuitability',
  tag: 'WorkSuitability',
  prefix: 'work-suitability',
  getDelegate: () => prisma.workSuitability as never,
  defaultSort: 'type',
  allowedSorts: ['type', 'level', 'createdAt'],
  buildWhere: (query, gameVersionId) => ({
    gameVersionId,
    ...(query.work || query.type
      ? { type: { equals: query.work ?? query.type, mode: 'insensitive' } }
      : {}),
    ...(query.level !== undefined ? { level: query.level } : {}),
  }),
});

export const workSuitabilityRoutes = workSuitabilityModule.routes;
