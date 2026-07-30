import { describe, expect, it } from 'vitest';
import { errorHandler } from '../error-handler';
import { AppError, ValidationError } from '../errors';

function mockReply() {
  const state: { statusCode?: number; payload?: unknown } = {};
  return {
    state,
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      state.payload = payload;
      return this;
    },
  };
}

describe('errorHandler', () => {
  it('formats AppError', () => {
    const reply = mockReply();
    errorHandler(
      new ValidationError('bad input', { field: 'email' }),
      { log: { error: () => undefined } } as never,
      reply as never,
    );
    expect(reply.state.statusCode).toBe(400);
    expect(reply.state.payload).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'bad input' },
    });
  });

  it('hides internal errors', () => {
    const reply = mockReply();
    const logs: unknown[] = [];
    errorHandler(new Error('boom'), {
      log: { error: (a: unknown) => logs.push(a) },
    } as never, reply as never);
    expect(reply.state.statusCode).toBe(500);
    expect(reply.state.payload).toMatchObject({
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('formats generic AppError codes', () => {
    const reply = mockReply();
    errorHandler(
      new AppError(409, 'dup', 'CONFLICT'),
      { log: { error: () => undefined } } as never,
      reply as never,
    );
    expect(reply.state.statusCode).toBe(409);
  });
});
