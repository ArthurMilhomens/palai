import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const technologiesModule = createEntityModule({
  name: 'Technology',
  tag: 'Technologies',
  prefix: 'technologies',
  getDelegate: () => prisma.technology as never,
  defaultSort: 'level',
  allowedSorts: ['level', 'name', 'unlockCost', 'createdAt'],
  include: { item: true },
  buildWhere: (query, gameVersionId) => ({
    gameVersionId,
    ...(query.q || query.name
      ? {
          OR: [
            { name: { contains: query.q ?? query.name, mode: 'insensitive' } },
            {
              internalName: {
                contains: query.q ?? query.name,
                mode: 'insensitive',
              },
            },
          ],
        }
      : {}),
    ...(query.level !== undefined ? { level: query.level } : {}),
    ...(query.technology
      ? {
          OR: [
            { internalName: query.technology },
            { name: { equals: query.technology, mode: 'insensitive' } },
          ],
        }
      : {}),
  }),
});

export const technologiesRoutes = technologiesModule.routes;
