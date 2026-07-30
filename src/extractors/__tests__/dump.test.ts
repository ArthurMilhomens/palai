import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { assertSafeZipEntry, extractJsonDump, extractZipDump } from '../dump';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('dump extractors', () => {
  it('extracts json dump', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'palai-'));
    try {
      const result = await extractJsonDump(
        Buffer.from(JSON.stringify({ version: '1.0.0', pals: [] })),
        dir,
      );
      expect(result.raw).toMatchObject({ version: '1.0.0' });
      expect(result.manifestPath).toContain('dump.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('extracts zip dump with dump.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'palai-'));
    try {
      const zip = new AdmZip();
      zip.addFile(
        'dump.json',
        Buffer.from(JSON.stringify({ version: '1.0.0', pals: [] })),
      );
      const result = await extractZipDump(zip.toBuffer(), dir);
      expect(result.raw).toMatchObject({ version: '1.0.0' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe zip entry names', () => {
    expect(() => assertSafeZipEntry('../evil.json')).toThrow(/Unsafe zip/);
    expect(() => assertSafeZipEntry('foo/../../evil.json')).toThrow(/Unsafe zip/);
  });
});
