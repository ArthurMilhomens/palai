import type { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';
import { authService, type JwtUser } from './service.js';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors.js';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from './schemas.js';

function signAccess(request: FastifyRequest) {
  return (payload: JwtUser) =>
    request.server.jwt.sign(payload, {
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
    });
}

export class AuthController {
  async register(request: FastifyRequest, reply: FastifyReply) {
    const body = registerSchema.parse(request.body);
    const user = await authService.register(body.email, body.password);
    return reply.status(201).send({ data: user });
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const body = loginSchema.parse(request.body);
    const result = await authService.login(
      body.email,
      body.password,
      signAccess(request),
    );
    return reply.send({ data: result });
  }

  async refresh(request: FastifyRequest, reply: FastifyReply) {
    const body = refreshSchema.parse(request.body);
    const tokens = await authService.refresh(body.refreshToken, signAccess(request));
    return reply.send({ data: tokens });
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const body = logoutSchema.parse(request.body);
    await authService.logout(body.refreshToken);
    return reply.status(204).send();
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as JwtUser | undefined;
    if (!user?.sub) throw new UnauthorizedError();
    const data = await authService.me(user.sub);
    return reply.send({ data });
  }
}

export const authController = new AuthController();

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or missing access token');
  }
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await authenticate(request, _reply);
    const user = request.user as JwtUser;
    if (!roles.includes(user.role)) {
      throw new ForbiddenError('Insufficient permissions');
    }
  };
}
