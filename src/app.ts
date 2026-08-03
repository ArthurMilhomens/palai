import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import fjwt from '@fastify/jwt';
import { Role } from '@prisma/client';
import { env, loadEnv } from './config/env.js';
import { errorHandler } from './shared/error-handler.js';
import { healthRoutes, httpRequestDuration, httpRequestsTotal } from './shared/health.js';
import { authRoutes } from './modules/auth/routes.js';
import { palsRoutes } from './modules/pals/routes.js';
import { skillsRoutes } from './modules/skills/routes.js';
import { passivesRoutes } from './modules/passives/routes.js';
import { itemsRoutes } from './modules/items/routes.js';
import { lootPoolsRoutes } from './modules/loot-pools/routes.js';
import { recipesRoutes } from './modules/recipes/routes.js';
import { technologiesRoutes } from './modules/technologies/routes.js';
import { locationsRoutes } from './modules/locations/routes.js';
import { bossesRoutes } from './modules/bosses/routes.js';
import { dungeonsRoutes } from './modules/dungeons/routes.js';
import { workSuitabilityRoutes } from './modules/workSuitability/routes.js';
import { breedingRoutes } from './modules/breeding/routes.js';
import { searchRoutes } from './modules/search/routes.js';
import { updatesRoutes } from './modules/updates/routes.js';
import type { JwtUser } from './modules/auth/service.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

export async function buildApp(options?: {
  logger?: boolean | object;
}): Promise<FastifyInstance> {
  loadEnv();
  const cfg = env();

  const app = Fastify({
    logger:
      options?.logger ??
      (cfg.NODE_ENV === 'test'
        ? false
        : {
            level: cfg.LOG_LEVEL,
            transport:
              cfg.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
          }),
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: cfg.CORS_ORIGIN === '*' ? true : cfg.CORS_ORIGIN.split(','),
  });
  await app.register(rateLimit, {
    max: cfg.RATE_LIMIT_MAX,
    timeWindow: cfg.RATE_LIMIT_TIME_WINDOW_MS,
    keyGenerator: (req) => {
      const user = req.user as JwtUser | undefined;
      return user?.sub ?? req.ip;
    },
  });
  await app.register(multipart, {
    limits: { fileSize: cfg.UPLOAD_MAX_BYTES },
  });
  await app.register(fjwt, {
    secret: cfg.JWT_ACCESS_SECRET,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Palai API',
        description: 'Palworld game data API',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  app.setErrorHandler(errorHandler);

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? req.url;
    const labels = {
      method: req.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
  });

  await app.register(healthRoutes);

  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(palsRoutes, { prefix: '/v1/pals' });
  await app.register(skillsRoutes, { prefix: '/v1/skills' });
  await app.register(passivesRoutes, { prefix: '/v1/passives' });
  await app.register(itemsRoutes, { prefix: '/v1/items' });
  await app.register(lootPoolsRoutes, { prefix: '/v1/loot-pools' });
  await app.register(recipesRoutes, { prefix: '/v1/recipes' });
  await app.register(technologiesRoutes, { prefix: '/v1/technologies' });
  await app.register(locationsRoutes, { prefix: '/v1/locations' });
  await app.register(bossesRoutes, { prefix: '/v1/bosses' });
  await app.register(dungeonsRoutes, { prefix: '/v1/dungeons' });
  await app.register(workSuitabilityRoutes, { prefix: '/v1/work-suitability' });
  await app.register(breedingRoutes, { prefix: '/v1/breeding' });
  await app.register(searchRoutes, { prefix: '/v1/search' });
  await app.register(updatesRoutes, { prefix: '/v1/updates' });

  void Role;
  return app;
}
