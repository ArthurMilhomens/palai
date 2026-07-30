import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const bossesModule = createEntityModule({
  name: 'Boss',
  tag: 'Bosses',
  prefix: 'bosses',
  getDelegate: () => prisma.boss as never,
  defaultSort: 'level',
  allowedSorts: ['level', 'internalName', 'respawnTime', 'createdAt'],
  include: { pal: true, location: true, dungeon: true },
});

export const bossesRoutes = bossesModule.routes;
