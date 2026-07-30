export type BreedingPal = {
  id: string;
  internalName: string;
  name: string;
  breedingPower: number | null;
};

export function computeTargetRank(bpA: number, bpB: number): number {
  return Math.floor((bpA + bpB + 1) / 2);
}

export function closestByBreedingPower<T extends { breedingPower: number | null }>(
  pals: T[],
  target: number,
): T | null {
  let best: T | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const pal of pals) {
    if (pal.breedingPower == null) continue;
    const dist = Math.abs(pal.breedingPower - target);
    if (dist < bestDist) {
      best = pal;
      bestDist = dist;
    }
  }
  return best;
}

export function findFormulaParents<T extends BreedingPal>(
  child: T,
  pals: T[],
  limit = 500,
): { parents: Array<{ parentA: T; parentB: T }>; total: number } {
  const parents: Array<{ parentA: T; parentB: T }> = [];
  if (child.breedingPower == null) {
    return { parents, total: 0 };
  }

  for (let i = 0; i < pals.length; i++) {
    for (let j = i; j < pals.length; j++) {
      const a = pals[i]!;
      const b = pals[j]!;
      if (a.breedingPower == null || b.breedingPower == null) continue;
      const target = computeTargetRank(a.breedingPower, b.breedingPower);
      const closest = closestByBreedingPower(pals, target);
      if (closest?.id === child.id) {
        parents.push({ parentA: a, parentB: b });
      }
    }
  }

  return {
    parents: parents.slice(0, limit),
    total: parents.length,
  };
}
