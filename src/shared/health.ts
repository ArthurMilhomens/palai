import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import { prisma } from '../prisma/client.js';
import { getRedis } from '../shared/cache.js';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/live', async () => ({ status: 'alive' }));

  app.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const redis = getRedis();
      if (redis.status !== 'ready') {
        await redis.connect().catch(() => undefined);
      }
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        return reply.status(503).send({ status: 'not_ready', redis: false });
      }
      return { status: 'ready', database: true, redis: true };
    } catch (error) {
      return reply.status(503).send({
        status: 'not_ready',
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });
}
