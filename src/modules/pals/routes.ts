import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/controller.js';
import { palsController } from './controller.js';

export async function palsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', {
    schema: { tags: ['Pals'], security: [{ bearerAuth: [] }] },
    handler: (req, reply) => palsController.list(req, reply),
  });

  app.get('/:idOrSlug', {
    schema: { tags: ['Pals'], security: [{ bearerAuth: [] }] },
    handler: (req, reply) => palsController.get(req, reply),
  });

  app.get('/:idOrSlug/drops', {
    schema: { tags: ['Pals'], security: [{ bearerAuth: [] }] },
    handler: (req, reply) => palsController.drops(req, reply),
  });

  app.get('/:idOrSlug/skills', {
    schema: { tags: ['Pals'], security: [{ bearerAuth: [] }] },
    handler: (req, reply) => palsController.skills(req, reply),
  });

  app.get('/:idOrSlug/work', {
    schema: { tags: ['Pals'], security: [{ bearerAuth: [] }] },
    handler: (req, reply) => palsController.work(req, reply),
  });

  app.get('/:idOrSlug/locations', {
    schema: { tags: ['Pals'], security: [{ bearerAuth: [] }] },
    handler: (req, reply) => palsController.locations(req, reply),
  });

  app.get('/:idOrSlug/breeding', {
    schema: { tags: ['Pals'], security: [{ bearerAuth: [] }] },
    handler: async (req, reply) => {
      const { breedingService } = await import('../breeding/service.js');
      const params = req.params as { idOrSlug: string };
      const query = req.query as { gameVersion?: string };
      const data = await breedingService.parentsFor(params.idOrSlug, query.gameVersion);
      return reply.send({ data });
    },
  });
}
