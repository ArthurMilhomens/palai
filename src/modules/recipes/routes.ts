import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const recipesModule = createEntityModule({
  name: 'Recipe',
  tag: 'Recipes',
  prefix: 'recipes',
  getDelegate: () => prisma.recipe as never,
  defaultSort: 'internalName',
  allowedSorts: ['internalName', 'craftTime', 'createdAt'],
  include: {
    resultItem: true,
    ingredients: { include: { item: true } },
  },
  buildWhere: (query, gameVersionId) => ({
    gameVersionId,
    ...(query.q
      ? {
          OR: [
            { internalName: { contains: query.q, mode: 'insensitive' } },
            { craftingStation: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }),
});

export const recipesRoutes = recipesModule.routes;
