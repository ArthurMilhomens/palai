import { PrismaClient } from '@prisma/client';
import { toPublicAssetUrl } from '../shared/storage.js';

const iconUrlField = {
  needs: { iconUrl: true as const },
  compute({ iconUrl }: { iconUrl: string | null }) {
    return toPublicAssetUrl(iconUrl);
  },
};

export const prisma = new PrismaClient().$extends({
  result: {
    element: { iconUrl: iconUrlField },
    pal: { iconUrl: iconUrlField },
    item: { iconUrl: iconUrlField },
  },
});

export type { PrismaClient };
