import { describe, expect, it } from 'vitest';
import { assertRole, hashToken } from '../crypto';
import { Role } from '@prisma/client';
import { ForbiddenError } from '../../../shared/errors';

describe('auth service helpers', () => {
  it('assertRole allows matching role', () => {
    expect(() => assertRole(Role.ADMIN, [Role.ADMIN])).not.toThrow();
  });

  it('assertRole rejects missing role', () => {
    expect(() => assertRole(Role.USER, [Role.ADMIN])).toThrow(ForbiddenError);
  });

  it('hashToken is sha256 hex', () => {
    expect(hashToken('token')).toMatch(/^[a-f0-9]{64}$/);
  });
});
