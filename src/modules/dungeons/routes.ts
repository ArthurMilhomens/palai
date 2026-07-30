import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const dungeonsModule = createEntityModule({
  name: 'Dungeon',
  tag: 'Dungeons',
  prefix: 'dungeons',
  getDelegate: () => prisma.dungeon as never,
  defaultSort: 'name',
  allowedSorts: ['name', 'minimumLevel', 'maximumLevel', 'biome', 'createdAt'],
  include: { location: true, bosses: true },
});

export const dungeonsRoutes = dungeonsModule.routes;
