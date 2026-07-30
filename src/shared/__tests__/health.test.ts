import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import type { FastifyInstance } from 'fastify';

describe('health routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /live', async () => {
    const res = await app.inject({ method: 'GET', url: '/live' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_requests_total');
  });

  it('rejects unauthenticated pals list', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/pals' });
    expect(res.statusCode).toBe(401);
  });
});
