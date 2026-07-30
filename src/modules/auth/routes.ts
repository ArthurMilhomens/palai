import type { FastifyInstance } from 'fastify';
import { authController, authenticate } from './controller.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Create a new user account',
    },
    handler: (req, reply) => authController.register(req, reply),
  });

  app.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login and receive access + refresh tokens',
    },
    handler: (req, reply) => authController.login(req, reply),
  });

  app.post('/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Rotate refresh token and issue a new access token',
    },
    handler: (req, reply) => authController.refresh(req, reply),
  });

  app.post('/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Revoke a refresh token',
    },
    handler: (req, reply) => authController.logout(req, reply),
  });

  app.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Current authenticated user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: authenticate,
    handler: (req, reply) => authController.me(req, reply),
  });
}
