import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const skillsModule = createEntityModule({
  name: 'Skill',
  tag: 'Skills',
  prefix: 'skills',
  getDelegate: () => prisma.skill as never,
  defaultSort: 'name',
  allowedSorts: ['name', 'power', 'cooldown', 'createdAt'],
  include: { element: true },
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
    ...(query.element
      ? {
          element: {
            OR: [
              { internalName: query.element },
              { name: { equals: query.element, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
    ...(query.category ? { category: query.category } : {}),
  }),
});

export const skillsRoutes = skillsModule.routes;
