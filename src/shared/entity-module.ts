import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client.js';
import { NotFoundError } from './errors.js';
import {
  paginatedResponse,
  toPrismaPage,
  type PaginationQuery,
} from './pagination.js';
import { listQuerySchema, type ListQuery } from './query.js';
import { resolveActiveGameVersionId } from './version.js';
import { cacheGet, cacheKey, cacheSet } from './cache.js';
import { authenticate } from '../modules/auth/controller.js';

type ModelDelegate = {
  count: (args: { where: unknown }) => Promise<number>;
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown | null>;
};

export function createEntityModule(options: {
  name: string;
  tag: string;
  prefix: string;
  getDelegate: () => ModelDelegate;
  defaultSort: string;
  allowedSorts: string[];
  buildWhere?: (query: ListQuery, gameVersionId: string) => Record<string, unknown>;
  include?: Record<string, unknown>;
}) {
  async function list(query: ListQuery) {
    const gameVersionId = await resolveActiveGameVersionId(query.gameVersion);
    const page = toPrismaPage(query);
    const where = options.buildWhere?.(query, gameVersionId) ?? {
      gameVersionId,
      ...(query.q || query.name
        ? {
            OR: [
              {
                name: {
                  contains: query.q ?? query.name,
                  mode: 'insensitive',
                },
              },
              {
                internalName: {
                  contains: query.q ?? query.name,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(query.rarity !== undefined ? { rarity: query.rarity } : {}),
      ...(query.type
        ? { type: { equals: query.type, mode: 'insensitive' } }
        : {}),
      ...(query.biome
        ? { biome: { equals: query.biome, mode: 'insensitive' } }
        : {}),
      ...(query.level !== undefined ? { level: query.level } : {}),
      ...(query.category
        ? { category: query.category }
        : {}),
    };

    const sort = options.allowedSorts.includes(query.sort ?? '')
      ? (query.sort as string)
      : options.defaultSort;
    const orderBy = { [sort]: query.order };
    const delegate = options.getDelegate();
    const [total, data] = await Promise.all([
      delegate.count({ where }),
      delegate.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy,
        include: options.include,
      }),
    ]);
    return paginatedResponse(data, total, query as PaginationQuery);
  }

  async function getByIdOrSlug(idOrSlug: string, gameVersion?: string) {
    const gameVersionId = await resolveActiveGameVersionId(gameVersion);
    const item = await options.getDelegate().findFirst({
      where: {
        gameVersionId,
        OR: [{ id: idOrSlug }, { internalName: idOrSlug }],
      },
      include: options.include,
    });
    if (!item) throw new NotFoundError(`${options.name} not found: ${idOrSlug}`);
    return item;
  }

  async function listCached(query: ListQuery) {
    const key = cacheKey({ route: `${options.prefix}:list`, ...query });
    const cached = await cacheGet<Awaited<ReturnType<typeof list>>>(key);
    if (cached) return cached;
    const result = await list(query);
    await cacheSet(key, result);
    return result;
  }

  async function routes(app: FastifyInstance) {
    app.addHook('preHandler', authenticate);

    app.get('/', {
      schema: { tags: [options.tag], security: [{ bearerAuth: [] }] },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const query = listQuerySchema.parse(req.query);
        const result = await listCached(query);
        return reply.send(result);
      },
    });

    app.get('/:idOrSlug', {
      schema: { tags: [options.tag], security: [{ bearerAuth: [] }] },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const params = req.params as { idOrSlug: string };
        const query = listQuerySchema.pick({ gameVersion: true }).parse(req.query);
        const data = await getByIdOrSlug(params.idOrSlug, query.gameVersion);
        return reply.send({ data });
      },
    });
  }

  return { list, listCached, getByIdOrSlug, routes };
}

void Prisma;
void prisma;
