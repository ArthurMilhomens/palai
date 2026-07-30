import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env';
import { ValidationError, NotFoundError, AppError } from '../errors';
import { cacheKey } from '../cache';

describe('env', () => {
  it('loads valid env from process', () => {
    const cfg = loadEnv();
    expect(cfg.PORT).toBeGreaterThan(0);
    expect(cfg.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

describe('errors', () => {
  it('creates typed app errors', () => {
    expect(new ValidationError('bad').statusCode).toBe(400);
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new AppError(418, 'teapot').statusCode).toBe(418);
  });
});

describe('cache key', () => {
  it('is stable for same payload', () => {
    const a = cacheKey({ route: 'pals:list', page: 1 });
    const b = cacheKey({ route: 'pals:list', page: 1 });
    expect(a).toBe(b);
    expect(a.startsWith('v1:pals:list:')).toBe(true);
  });
});
