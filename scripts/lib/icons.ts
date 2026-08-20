import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DataTableRows } from './datatable.js';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** /Game/.../T_Foo.T_Foo → T_Foo */
export function textureBaseFromAssetPath(assetPath: string | null | undefined): string | null {
  if (!assetPath || typeof assetPath !== 'string') return null;
  const trimmed = assetPath.trim();
  if (!trimmed || trimmed === 'None') return null;
  const leaf = trimmed.split('/').pop() ?? trimmed;
  const base = leaf.split('.')[0] ?? leaf;
  return base || null;
}

export function iconTextureFromRow(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  for (const key of ['Icon', 'SoftIcon', 'icon', 'softIcon']) {
    const icon = row[key];
    if (icon && typeof icon === 'object') {
      const obj = icon as Record<string, unknown>;
      const tex = textureBaseFromAssetPath(
        typeof obj.AssetPathName === 'string' ? obj.AssetPathName : null,
      );
      if (tex) return tex;
    }
    if (typeof icon === 'string') {
      const tex = textureBaseFromAssetPath(icon);
      if (tex) return tex;
    }
  }
  return null;
}

/**
 * Index PNG/JPG under iconsDir by basename (no extension) → relative path with extension.
 * Prefer shallow files over nested when duplicates exist.
 */
export async function indexIconFiles(
  iconsDir: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!(await exists(iconsDir))) return map;

  async function walk(dir: string, rel = ''): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, childRel);
        continue;
      }
      if (!/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
      const base = path.basename(entry.name, path.extname(entry.name));
      const existing = map.get(base);
      if (!existing || childRel.split(/[/\\]/).length < existing.split(/[/\\]/).length) {
        map.set(base, childRel.replace(/\\/g, '/'));
      }
    }
  }

  await walk(iconsDir);
  return map;
}

export function buildIconLookupFromRows(
  rows: DataTableRows | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!rows) return map;
  for (const [key, row] of Object.entries(rows)) {
    const tex = iconTextureFromRow(row);
    if (tex) map.set(key, tex);
  }
  return map;
}

export function resolveIconPath(
  internalName: string,
  iconByEntity: Map<string, string>,
  filesByBase: Map<string, string>,
  aliases: Array<string | null | undefined> = [],
): string | null {
  const keys = [internalName, ...aliases]
    .map((k) => (typeof k === 'string' ? k.trim() : ''))
    .filter((k) => k && k !== 'None');

  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);

    const texture = iconByEntity.get(key);
    if (texture) {
      const file = filesByBase.get(texture);
      if (file) return file;
    }

    // Direct filename heuristics (when DataTable row is missing)
    for (const candidate of [
      key,
      `T_itemicon_Material_${key}`,
      `T_itemicon_${key}`,
      `T_icon_buildObject_${key}`,
      `T_${key}_icon_normal`,
    ]) {
      const file = filesByBase.get(candidate);
      if (file) return file;
    }
  }

  return null;
}
