import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env().REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = getRedis();
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export function cacheKey(parts: Record<string, unknown>): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 24);
  return `v1:${String(parts.route)}:${hash}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await getRedis().get(key);
  if (!value) return null;
  return JSON.parse(value) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const ttl = ttlSeconds ?? env().CACHE_TTL_SECONDS;
  await getRedis().set(key, JSON.stringify(value), 'EX', ttl);
}

export async function cacheFlushNamespace(prefix = 'v1:'): Promise<number> {
  const client = getRedis();
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) {
      deleted += await client.del(...keys);
    }
  } while (cursor !== '0');
  return deleted;
}
