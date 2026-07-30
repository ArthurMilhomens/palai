import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

export function errorHandler(
  error: Error,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code ?? 'APP_ERROR',
        message: error.message,
        details: error.details ?? undefined,
      },
    });
  }

  const validation = error as Error & {
    validation?: unknown;
    statusCode?: number;
  };
  if (validation.validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: validation.message,
        details: validation.validation,
      },
    });
  }

  const statusCode =
    typeof validation.statusCode === 'number' ? validation.statusCode : 500;

  if (statusCode >= 500) {
    _request.log.error({ err: error }, 'Unhandled error');
  }

  return reply.status(statusCode).send({
    error: {
      code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
    },
  });
}
