import type { FastifyRequest } from 'fastify';

const DEFAULT_LOCALE = 'en';

export function resolveLocale(request: FastifyRequest, queryLang?: string): string {
  if (queryLang && queryLang.trim()) {
    return normalizeLocale(queryLang);
  }
  const header = request.headers['accept-language'];
  if (!header) return DEFAULT_LOCALE;
  const first = header.split(',')[0]?.trim().split(';')[0];
  return first ? normalizeLocale(first) : DEFAULT_LOCALE;
}

function normalizeLocale(value: string): string {
  return value.replace('_', '-').trim();
}

export function pickTranslation(
  translations: Array<{ locale: string; field: string; value: string }>,
  field: string,
  locale: string,
  fallback?: string | null,
): string | null {
  const exact = translations.find((t) => t.locale === locale && t.field === field);
  if (exact) return exact.value;
  const lang = locale.split('-')[0];
  const partial = translations.find(
    (t) => t.locale.startsWith(lang) && t.field === field,
  );
  if (partial) return partial.value;
  const en = translations.find((t) => t.locale === 'en' && t.field === field);
  if (en) return en.value;
  return fallback ?? null;
}
