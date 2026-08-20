/** Accent-insensitive + typo-tolerant matching for craft-tree search. */

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const long = a.length >= b.length ? a : b;
  const short = a.length < b.length ? a : b;
  if (long.includes(short)) {
    // Avoid "arco" matching inside "charcoal" — require prefix/suffix or long overlap
    if (
      long.startsWith(short) ||
      long.endsWith(short) ||
      short.length / long.length >= 0.6
    ) {
      return 0.85 + (0.1 * short.length) / long.length;
    }
  }

  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Score how well `query` matches `candidate` (0–1).
 * Requires every query token to roughly match some candidate token.
 */
export function fuzzyScore(query: string, candidate: string): number {
  const q = normalizeSearchText(query);
  const c = normalizeSearchText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;

  const cTokens = c.split(' ').filter(Boolean);
  const qTokens = q.split(' ').filter(Boolean);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  // Whole-query containment only when it aligns to tokens (not mid-word)
  if (c.includes(q)) {
    const joined = cTokens.join(' ');
    if (
      cTokens.some((t) => t === q || t.startsWith(q)) ||
      joined.startsWith(q) ||
      q.length >= 6
    ) {
      return 0.96;
    }
  }
  if (q.includes(c) && c.length >= 3) return 0.9;

  let sum = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const ct of cTokens) {
      best = Math.max(best, tokenSimilarity(qt, ct));
    }
    // Short tokens need near-exact match; longer allow typos
    const minOk = qt.length <= 3 ? 0.85 : qt.length <= 5 ? 0.7 : 0.58;
    if (best < minOk) return 0;
    sum += best;
  }

  const avg = sum / qTokens.length;
  // Prefer names with similar length (arco mecânico ≫ flecha de arco mecânico)
  const coverage =
    qTokens.length / Math.max(cTokens.length, qTokens.length);
  return avg * (0.72 + 0.28 * coverage);
}

/** Best score across several candidate labels. */
export function bestFuzzyScore(query: string, candidates: string[]): number {
  let best = 0;
  for (const c of candidates) {
    best = Math.max(best, fuzzyScore(query, c));
  }
  return best;
}
