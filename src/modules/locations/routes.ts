import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const locationsModule = createEntityModule({
  name: 'Location',
  tag: 'Locations',
  prefix: 'locations',
  getDelegate: () => prisma.location as never,
  defaultSort: 'name',
  allowedSorts: ['name', 'level', 'biome', 'createdAt'],
});

export const locationsRoutes = locationsModule.routes;
