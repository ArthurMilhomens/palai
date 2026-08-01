import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

export type DataTableRows = Record<string, Record<string, unknown>>;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function walkJsonFiles(root: string, depth = 0, maxDepth = 8): Promise<string[]> {
  if (depth > maxDepth || !(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(full, depth + 1, maxDepth)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

function unwrapRows(data: unknown): DataTableRows | null {
  if (!data || typeof data !== 'object') return null;

  // FModel array export: [{ Type, Name, Rows }]
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === 'object' && 'Rows' in item) {
        const rows = (item as { Rows?: unknown }).Rows;
        if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
          return rows as DataTableRows;
        }
      }
    }
  }

  const obj = data as Record<string, unknown>;

  if (obj.Rows && typeof obj.Rows === 'object' && !Array.isArray(obj.Rows)) {
    return obj.Rows as DataTableRows;
  }

  // Already a rows map (PalSchema-like / raw)
  const values = Object.values(obj);
  if (
    values.length > 0 &&
    values.every((v) => v && typeof v === 'object' && !Array.isArray(v))
  ) {
    // Heuristic: avoid treating localization root as rows if too shallow weirdness
    return obj as DataTableRows;
  }

  return null;
}

export async function loadNamedDataTable(
  exportDirs: string[],
  tableNames: string[],
): Promise<{ tableName: string; filePath: string; rows: DataTableRows } | null> {
  const wantedExact = tableNames.map((n) => n.toLowerCase());
  type Candidate = {
    tableName: string;
    filePath: string;
    rows: DataTableRows;
    exact: boolean;
  };
  const candidates: Candidate[] = [];

  for (const dir of exportDirs) {
    const files = await walkJsonFiles(dir);
    for (const file of files) {
      const base = path.basename(file, '.json');
      const baseLower = base.toLowerCase();

      let matchedName: string | undefined;
      let exact = false;
      for (const name of wantedExact) {
        if (baseLower === name) {
          matchedName = tableNames[wantedExact.indexOf(name)];
          exact = true;
          break;
        }
      }
      if (!matchedName) {
        for (const name of wantedExact) {
          // Avoid matching DT_Foo_Common when looking for DT_Foo
          if (baseLower.startsWith(`${name}_`)) continue;
          if (baseLower.startsWith(name)) {
            matchedName = tableNames[wantedExact.indexOf(name)];
            break;
          }
        }
      }
      if (!matchedName) continue;

      try {
        const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
        const rows = unwrapRows(raw);
        if (!rows || Object.keys(rows).length === 0) continue;
        candidates.push({
          tableName: matchedName,
          filePath: file,
          rows,
          exact,
        });
      } catch {
        // ignore invalid json
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact));
  const best = candidates[0]!;
  return {
    tableName: best.tableName,
    filePath: best.filePath,
    rows: best.rows,
  };
}

/**
 * Loads a DataTable from a locale folder (e.g. l10n/en, l10n/pt-BR).
 * Accepts DT_Foo and DT_Foo_Common under that locale path.
 */
export async function loadLocaleNamedDataTable(
  exportDirs: string[],
  locale: string,
  tableNames: string[],
): Promise<{ tableName: string; filePath: string; rows: DataTableRows } | null> {
  const wantedExact = tableNames.map((n) => n.toLowerCase());
  const localeNeedle = `${path.sep}l10n${path.sep}${locale}${path.sep}`.toLowerCase();
  const localeNeedleAlt = `/l10n/${locale}/`.toLowerCase();

  type Candidate = {
    tableName: string;
    filePath: string;
    rows: DataTableRows;
    score: number;
  };
  const candidates: Candidate[] = [];

  for (const dir of exportDirs) {
    const files = await walkJsonFiles(dir);
    for (const file of files) {
      const normalized = file.replace(/\//g, path.sep).toLowerCase();
      if (
        !normalized.includes(localeNeedle) &&
        !normalized.includes(localeNeedleAlt)
      ) {
        continue;
      }

      const base = path.basename(file, '.json');
      const baseLower = base.toLowerCase();

      let matchedName: string | undefined;
      let score = 0;
      for (let i = 0; i < wantedExact.length; i++) {
        const name = wantedExact[i]!;
        if (baseLower === name) {
          matchedName = tableNames[i];
          score = 3;
          break;
        }
        if (baseLower === `${name}_common`) {
          matchedName = tableNames[i];
          score = 2;
          break;
        }
        if (baseLower.startsWith(`${name}_`)) {
          matchedName = tableNames[i];
          score = 1;
          break;
        }
      }
      if (!matchedName) continue;

      try {
        const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
        const rows = unwrapRows(raw);
        if (!rows || Object.keys(rows).length === 0) continue;
        candidates.push({
          tableName: matchedName,
          filePath: file,
          rows,
          score,
        });
      } catch {
        // ignore invalid json
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  return {
    tableName: best.tableName,
    filePath: best.filePath,
    rows: best.rows,
  };
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.TagName === 'string') return obj.TagName;
    if (typeof obj.Name === 'string') return obj.Name;
    if (typeof obj.SourceString === 'string') return obj.SourceString;
    if (typeof obj.LocalizedString === 'string') return obj.LocalizedString;
    if (typeof obj.CultureInvariantString === 'string') {
      return obj.CultureInvariantString;
    }
    if (typeof obj.Key === 'string') return obj.Key;
  }
  return null;
}

export function extractLocalizedText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const textData =
    obj.TextData && typeof obj.TextData === 'object'
      ? (obj.TextData as Record<string, unknown>)
      : obj;
  return (
    (typeof textData.LocalizedString === 'string' && textData.LocalizedString) ||
    (typeof textData.SourceString === 'string' && textData.SourceString) ||
    (typeof textData.CultureInvariantString === 'string' &&
      textData.CultureInvariantString) ||
    null
  );
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

export function stripEnumPrefix(value: string | null, prefixes: string[]): string | null {
  if (!value) return null;
  let out = value;
  for (const prefix of prefixes) {
    if (out.startsWith(prefix)) out = out.slice(prefix.length);
  }
  return out.replace(/^::/, '') || null;
}
