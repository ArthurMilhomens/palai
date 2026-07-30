import { prisma } from '../prisma/client.js';
import { NotFoundError } from './errors.js';

export async function resolveActiveGameVersionId(
  gameVersion?: string,
): Promise<string> {
  if (gameVersion) {
    const version = await prisma.gameVersion.findFirst({
      where: {
        OR: [{ id: gameVersion }, { version: gameVersion }],
      },
    });
    if (!version) throw new NotFoundError(`Game version not found: ${gameVersion}`);
    return version.id;
  }
  const active = await prisma.gameVersion.findFirst({
    where: { isActive: true },
    orderBy: { importedAt: 'desc' },
  });
  if (!active) {
    throw new NotFoundError('No active game version. Import data first.');
  }
  return active.id;
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  ) || /^c[a-z0-9]{24}$/i.test(value);
}
