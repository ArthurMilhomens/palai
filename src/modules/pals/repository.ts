import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client.js';
import { NotFoundError } from '../../shared/errors.js';
import {
  paginatedResponse,
  toPrismaPage,
  type PaginationQuery,
} from '../../shared/pagination.js';
import { isUuidLike, resolveActiveGameVersionId } from '../../shared/version.js';
import type { ListQuery } from '../../shared/query.js';

export class PalsRepository {
  async list(query: ListQuery) {
    const gameVersionId = await resolveActiveGameVersionId(query.gameVersion);
    const page = toPrismaPage(query);

    const translationIds = query.q
      ? (
          await prisma.translation.findMany({
            where: {
              gameVersionId,
              entityType: 'pal',
              field: 'name',
              value: { contains: query.q, mode: 'insensitive' },
            },
            select: { entityId: true },
            take: 200,
          })
        ).map((r) => r.entityId)
      : [];

    const where: Prisma.PalWhereInput = {
      gameVersionId,
      ...(query.name
        ? { name: { contains: query.name, mode: 'insensitive' } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { internalName: { contains: query.q, mode: 'insensitive' } },
              ...(translationIds.length > 0
                ? [{ id: { in: translationIds } }]
                : []),
            ],
          }
        : {}),
      ...(query.rarity !== undefined ? { rarity: query.rarity } : {}),
      ...(query.element
        ? {
            elements: {
              some: {
                element: {
                  OR: [
                    { internalName: query.element },
                    { name: { equals: query.element, mode: 'insensitive' } },
                  ],
                },
              },
            },
          }
        : {}),
      ...(query.work
        ? {
            workSuitabilities: {
              some: {
                workSuitability: {
                  type: { equals: query.work, mode: 'insensitive' },
                },
              },
            },
          }
        : {}),
      ...(query.biome
        ? {
            habitats: {
              some: {
                location: {
                  biome: { equals: query.biome, mode: 'insensitive' },
                },
              },
            },
          }
        : {}),
    };

    const orderBy = buildOrderBy(query) as Prisma.PalOrderByWithRelationInput;
    const [total, data] = await Promise.all([
      prisma.pal.count({ where }),
      prisma.pal.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy,
        include: {
          elements: { include: { element: true } },
          workSuitabilities: { include: { workSuitability: true } },
        },
      }),
    ]);
    return paginatedResponse(data, total, query as PaginationQuery);
  }

  async findByIdOrSlug(idOrSlug: string, gameVersion?: string) {
    const gameVersionId = await resolveActiveGameVersionId(gameVersion);
    const pal = await prisma.pal.findFirst({
      where: {
        gameVersionId,
        OR: [
          { id: idOrSlug },
          { internalName: idOrSlug },
          ...(Number.isFinite(Number(idOrSlug))
            ? [{ paldexNumber: Number(idOrSlug) }]
            : []),
        ],
      },
      include: {
        elements: { include: { element: true } },
        skills: { include: { skill: { include: { element: true } } } },
        passives: { include: { passiveSkill: true } },
        workSuitabilities: { include: { workSuitability: true } },
        drops: {
          include: {
            item: {
              select: {
                id: true,
                internalName: true,
                name: true,
                description: true,
                iconUrl: true,
                rarity: true,
                kind: true,
              },
            },
          },
        },
        habitats: { include: { location: true } },
        bosses: {
          include: {
            location: true,
            dungeon: true,
          },
        },
        breedingAsChild: {
          include: {
            parentA: {
              select: {
                id: true,
                internalName: true,
                name: true,
                iconUrl: true,
                paldexNumber: true,
              },
            },
            parentB: {
              select: {
                id: true,
                internalName: true,
                name: true,
                iconUrl: true,
                paldexNumber: true,
              },
            },
          },
        },
        breedingAsParentA: {
          take: 40,
          include: {
            parentB: {
              select: {
                id: true,
                internalName: true,
                name: true,
                iconUrl: true,
                paldexNumber: true,
              },
            },
            child: {
              select: {
                id: true,
                internalName: true,
                name: true,
                iconUrl: true,
                paldexNumber: true,
              },
            },
          },
        },
        breedingAsParentB: {
          take: 40,
          include: {
            parentA: {
              select: {
                id: true,
                internalName: true,
                name: true,
                iconUrl: true,
                paldexNumber: true,
              },
            },
            child: {
              select: {
                id: true,
                internalName: true,
                name: true,
                iconUrl: true,
                paldexNumber: true,
              },
            },
          },
        },
      },
    });
    if (!pal) throw new NotFoundError(`Pal not found: ${idOrSlug}`);
    return pal;
  }

  async drops(idOrSlug: string, gameVersion?: string) {
    const pal = await this.findByIdOrSlug(idOrSlug, gameVersion);
    return pal.drops;
  }

  async skills(idOrSlug: string, gameVersion?: string) {
    const pal = await this.findByIdOrSlug(idOrSlug, gameVersion);
    return {
      active: pal.skills.filter((s) => !s.isPartner),
      partner: pal.skills.filter((s) => s.isPartner),
      passives: pal.passives,
    };
  }

  async work(idOrSlug: string, gameVersion?: string) {
    const pal = await this.findByIdOrSlug(idOrSlug, gameVersion);
    return pal.workSuitabilities;
  }

  async locations(idOrSlug: string, gameVersion?: string) {
    const pal = await this.findByIdOrSlug(idOrSlug, gameVersion);
    return pal.habitats;
  }
}

function buildOrderBy(query: ListQuery) {
  const sort = query.sort ?? 'paldexNumber';
  const allowed = new Set([
    'paldexNumber',
    'name',
    'rarity',
    'hp',
    'attack',
    'defense',
    'breedingPower',
    'createdAt',
  ]);
  const field = allowed.has(sort) ? sort : 'paldexNumber';
  return { [field]: query.order };
}

export const palsRepository = new PalsRepository();

export function assertIdOrSlug(value: string): string {
  if (!value) throw new NotFoundError('Missing id');
  return value;
}

void isUuidLike;
