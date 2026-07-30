import { describe, expect, it } from 'vitest';
import {
  paginationQuerySchema,
  paginatedResponse,
  toPrismaPage,
} from '../../../shared/pagination';
import { pickTranslation, resolveLocale } from '../../../shared/i18n';
import { hashToken } from '../crypto';

describe('pagination', () => {
  it('parses defaults', () => {
    const q = paginationQuerySchema.parse({});
    expect(q.page).toBe(1);
    expect(q.limit).toBe(20);
    expect(q.order).toBe('asc');
  });

  it('builds prisma page', () => {
    const page = toPrismaPage({ page: 3, limit: 10, order: 'desc' });
    expect(page.skip).toBe(20);
    expect(page.take).toBe(10);
  });

  it('builds paginated response meta', () => {
    const result = paginatedResponse([{ id: 1 }], 25, {
      page: 1,
      limit: 10,
      order: 'asc',
    });
    expect(result.meta.totalPages).toBe(3);
    expect(result.meta.total).toBe(25);
  });
});

describe('i18n', () => {
  it('uses Accept-Language when lang query missing', () => {
    const locale = resolveLocale({
      headers: { 'accept-language': 'pt-BR,pt;q=0.9' },
    } as never);
    expect(locale).toBe('pt-BR');
  });

  it('defaults to en', () => {
    expect(resolveLocale({ headers: {} } as never)).toBe('en');
  });

  it('picks exact translation then fallback', () => {
    const translations = [
      { locale: 'en', field: 'name', value: 'Anubis' },
      { locale: 'pt-BR', field: 'name', value: 'Anúbis' },
    ];
    expect(pickTranslation(translations, 'name', 'pt-BR', 'X')).toBe('Anúbis');
    expect(pickTranslation(translations, 'name', 'fr-FR', 'X')).toBe('Anubis');
  });
});

describe('auth helpers', () => {
  it('hashes refresh tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abcd'));
  });
});
