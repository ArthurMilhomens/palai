import { describe, expect, it } from 'vitest';
import { isUuidLike } from '../version';

describe('isUuidLike', () => {
  it('detects cuid-like and uuid-like ids', () => {
    expect(isUuidLike('cabcdefghijklmnopqrstuvwx')).toBe(true);
    expect(isUuidLike('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuidLike('Anubis')).toBe(false);
  });
});
