import { prisma } from '../../prisma/client.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { resolveActiveGameVersionId } from '../../shared/version.js';
import {
  closestByBreedingPower,
  computeTargetRank,
  findFormulaParents,
} from './formula.js';

export class BreedingService {
  async predict(parentA: string, parentB: string, gameVersion?: string) {
    if (!parentA || !parentB) {
      throw new ValidationError('parentA and parentB are required');
    }
    const gameVersionId = await resolveActiveGameVersionId(gameVersion);
    const [a, b] = await Promise.all([
      this.findPal(parentA, gameVersionId),
      this.findPal(parentB, gameVersionId),
    ]);

    const override = await prisma.breedingOverride.findFirst({
      where: {
        gameVersionId,
        OR: [
          { parentAId: a.id, parentBId: b.id },
          { parentAId: b.id, parentBId: a.id },
        ],
      },
      include: { child: true, parentA: true, parentB: true },
    });
    if (override) {
      return {
        method: 'override' as const,
        parentA: a,
        parentB: b,
        child: override.child,
      };
    }

    if (a.internalName === b.internalName) {
      return {
        method: 'same_species' as const,
        parentA: a,
        parentB: b,
        child: a,
      };
    }

    if (a.breedingPower == null || b.breedingPower == null) {
      throw new ValidationError('Both parents must have breedingPower');
    }

    const target = computeTargetRank(a.breedingPower, b.breedingPower);
    const pals = await prisma.pal.findMany({
      where: { gameVersionId, breedingPower: { not: null } },
      select: {
        id: true,
        internalName: true,
        name: true,
        breedingPower: true,
        paldexNumber: true,
      },
    });
    const child = closestByBreedingPower(pals, target);
    if (!child) throw new NotFoundError('No breeding candidate found');
    return {
      method: 'combi_rank' as const,
      parentA: a,
      parentB: b,
      targetRank: target,
      child,
    };
  }

  async parentsFor(childIdOrSlug: string, gameVersion?: string) {
    const gameVersionId = await resolveActiveGameVersionId(gameVersion);
    const child = await this.findPal(childIdOrSlug, gameVersionId);
    const overrides = await prisma.breedingOverride.findMany({
      where: { gameVersionId, childId: child.id },
      include: { parentA: true, parentB: true },
    });

    const pals = await prisma.pal.findMany({
      where: {
        gameVersionId,
        breedingPower: { not: null },
      },
      select: {
        id: true,
        internalName: true,
        name: true,
        breedingPower: true,
      },
    });

    const { parents: formulaParents, total } = findFormulaParents(child, pals, 500);

    return {
      child,
      overrides: overrides.map((o) => ({
        parentA: o.parentA,
        parentB: o.parentB,
      })),
      formulaParents,
      formulaParentsTruncated: total > 500,
      formulaParentsTotal: total,
    };
  }

  private async findPal(idOrSlug: string, gameVersionId: string) {
    const pal = await prisma.pal.findFirst({
      where: {
        gameVersionId,
        OR: [{ id: idOrSlug }, { internalName: idOrSlug }],
      },
      select: {
        id: true,
        internalName: true,
        name: true,
        breedingPower: true,
        paldexNumber: true,
      },
    });
    if (!pal) throw new NotFoundError(`Pal not found: ${idOrSlug}`);
    return pal;
  }
}

export const breedingService = new BreedingService();
