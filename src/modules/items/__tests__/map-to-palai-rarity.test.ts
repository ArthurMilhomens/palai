import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertExportsToPalaiDump } from '../../../../scripts/lib/map-to-palai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../..');
const FMODEL_DIR = path.join(ROOT, 'game_data/fmodel');

describe('map-to-palai OverrideName + rarity', () => {
  it('resolves BowGun_3 name via OverrideName and sets rarity 2', async () => {
    const { dump } = await convertExportsToPalaiDump({
      exportDirs: [FMODEL_DIR],
      iconsDir: path.join(ROOT, 'game_data/icons'),
      version: 'test',
      build: '0',
    });

    const bowGun3 = dump.items.find((i) => i.internalName === 'BowGun_3');
    expect(bowGun3).toBeDefined();
    expect(bowGun3!.rarity).toBe(2);
    expect(bowGun3!.name).toBe('Crossbow');

    const bowGun = dump.items.find((i) => i.internalName === 'BowGun');
    expect(bowGun?.rarity).toBe(0);
    expect(bowGun?.name).toBe('Crossbow');

    const en = dump.translations.find(
      (t) =>
        t.entityType === 'item' &&
        t.entityInternalName === 'BowGun_3' &&
        t.locale === 'en' &&
        t.field === 'name',
    );
    const pt = dump.translations.find(
      (t) =>
        t.entityType === 'item' &&
        t.entityInternalName === 'BowGun_3' &&
        t.locale === 'pt-BR' &&
        t.field === 'name',
    );
    expect(en?.value).toBe('Crossbow');
    expect(pt?.value).toBe('Besta');
  }, 120_000);
});
