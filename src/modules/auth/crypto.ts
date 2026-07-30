import { createHash } from 'node:crypto';
import { Role } from '@prisma/client';
import { ForbiddenError } from '../../shared/errors.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function assertRole(userRole: Role, allowed: Role[]): void {
  if (!allowed.includes(userRole)) {
    throw new ForbiddenError('Insufficient permissions');
  }
}
