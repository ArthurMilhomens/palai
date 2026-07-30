import { prisma } from '../../prisma/client.js';
import { createEntityModule } from '../../shared/entity-module.js';

export const passivesModule = createEntityModule({
  name: 'PassiveSkill',
  tag: 'Passives',
  prefix: 'passives',
  getDelegate: () => prisma.passiveSkill as never,
  defaultSort: 'name',
  allowedSorts: ['name', 'rarity', 'createdAt'],
});

export const passivesRoutes = passivesModule.routes;
