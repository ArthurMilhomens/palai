import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Role } from '@prisma/client';
import { prisma } from '../../prisma/client.js';
import { env } from '../../config/env.js';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors.js';
import { hashToken } from './crypto.js';

export { hashToken, assertRole } from './crypto.js';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

export type JwtUser = {
  sub: string;
  role: Role;
  jti: string;
};

export class AuthService {
  async register(email: string, password: string) {
    const existing = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    if (existing) {
      throw new ConflictError('Email already registered');
    }
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        role: Role.USER,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    return user;
  }

  async login(
    email: string,
    password: string,
    signAccess: (payload: JwtUser) => string,
  ): Promise<{ user: { id: string; email: string; role: Role }; tokens: AuthTokens }> {
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedError('Invalid credentials');
    }
    const tokens = await this.issueTokens(user.id, user.role, signAccess);
    return {
      user: { id: user.id, email: user.email, role: user.role },
      tokens,
    };
  }

  async refresh(
    refreshToken: string,
    signAccess: (payload: JwtUser) => string,
  ): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) {
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (stored.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedError('Refresh token reuse detected');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token expired');
    }
    const user = await prisma.user.findFirst({
      where: { id: stored.userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user.id, user.role, signAccess, stored.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new UnauthorizedError('User not found');
    return user;
  }

  async bootstrapAdmin(): Promise<void> {
    const cfg = env();
    if (!cfg.BOOTSTRAP_ADMIN_EMAIL || !cfg.BOOTSTRAP_ADMIN_PASSWORD) return;
    const email = cfg.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) return;
    const passwordHash = await argon2.hash(cfg.BOOTSTRAP_ADMIN_PASSWORD, {
      type: argon2.argon2id,
    });
    await prisma.user.create({
      data: { email, passwordHash, role: Role.ADMIN },
    });
  }

  private async issueTokens(
    userId: string,
    role: Role,
    signAccess: (payload: JwtUser) => string,
    familyId = randomBytes(16).toString('hex'),
  ): Promise<AuthTokens> {
    const jti = randomBytes(16).toString('hex');
    const accessToken = signAccess({ sub: userId, role, jti });
    const refreshToken = randomBytes(48).toString('base64url');
    const tokenHash = hashToken(refreshToken);
    const days = env().REFRESH_TOKEN_TTL_DAYS;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { userId, tokenHash, familyId, expiresAt },
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: env().JWT_ACCESS_TTL,
    };
  }
}

export const authService = new AuthService();
