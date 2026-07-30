import { describe, expect, it } from 'vitest';
import { registerSchema, loginSchema, refreshSchema } from '../schemas';

describe('auth schemas', () => {
  it('validates register', () => {
    expect(
      registerSchema.parse({ email: 'a@b.com', password: 'password1' }),
    ).toEqual({ email: 'a@b.com', password: 'password1' });
    expect(() =>
      registerSchema.parse({ email: 'bad', password: 'short' }),
    ).toThrow();
  });

  it('validates login and refresh', () => {
    expect(loginSchema.parse({ email: 'a@b.com', password: 'x' }).email).toBe(
      'a@b.com',
    );
    expect(refreshSchema.parse({ refreshToken: '1234567890' }).refreshToken).toBe(
      '1234567890',
    );
  });
});
