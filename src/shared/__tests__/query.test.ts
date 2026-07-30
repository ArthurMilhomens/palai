import { describe, expect, it } from 'vitest';
import { listQuerySchema, idOrSlugParamsSchema } from '../query';

describe('listQuerySchema', () => {
  it('coerces pagination and filters', () => {
    const parsed = listQuerySchema.parse({
      page: '2',
      limit: '5',
      element: 'Fire',
      rarity: '3',
    });
    expect(parsed.page).toBe(2);
    expect(parsed.limit).toBe(5);
    expect(parsed.element).toBe('Fire');
    expect(parsed.rarity).toBe(3);
  });

  it('parses idOrSlug', () => {
    expect(idOrSlugParamsSchema.parse({ idOrSlug: 'Anubis' }).idOrSlug).toBe(
      'Anubis',
    );
  });
});
