import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import AdmZip from 'adm-zip';
import { ValidationError } from '../shared/errors.js';

export type ExtractedDump = {
  workspace: string;
  manifestPath: string;
  iconsDir: string | null;
  raw: unknown;
};

export function assertSafeZipEntry(entryName: string): void {
  const posix = entryName.replace(/\\/g, '/');
  if (
    posix.includes('..') ||
    path.isAbsolute(entryName) ||
    /^[A-Za-z]:/.test(entryName)
  ) {
    throw new ValidationError(`Unsafe zip entry: ${entryName}`);
  }
}

export async function extractZipDump(
  zipBuffer: Buffer,
  workspaceRoot: string,
): Promise<ExtractedDump> {
  await mkdir(workspaceRoot, { recursive: true });
  const zip = new AdmZip(zipBuffer);
  for (const entry of zip.getEntries()) {
    assertSafeZipEntry(entry.entryName);
  }
  zip.extractAllTo(workspaceRoot, true);

  const candidates = [
    path.join(workspaceRoot, 'dump.json'),
    path.join(workspaceRoot, 'data.json'),
    path.join(workspaceRoot, 'manifest.json'),
  ];

  let manifestPath: string | null = null;
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      manifestPath = candidate;
      break;
    } catch {
      // try next
    }
  }

  if (!manifestPath) {
    // look one level deep
    const zipEntries = zip.getEntries().filter((e) => e.entryName.endsWith('.json'));
    const firstJson = zipEntries.find((e) =>
      ['dump.json', 'data.json', 'manifest.json'].some((n) =>
        e.entryName.endsWith(n),
      ),
    );
    if (firstJson) {
      manifestPath = path.join(workspaceRoot, firstJson.entryName);
    }
  }

  if (!manifestPath) {
    throw new ValidationError(
      'Dump zip must contain dump.json, data.json, or manifest.json',
    );
  }

  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const iconsDirCandidates = [
    path.join(workspaceRoot, 'icons'),
    path.join(path.dirname(manifestPath), 'icons'),
  ];
  let iconsDir: string | null = null;
  for (const dir of iconsDirCandidates) {
    try {
      await readFile(path.join(dir, '.keep')).catch(async () => {
        // directory may exist without .keep — check via reading any entry later
      });
      iconsDir = dir;
      break;
    } catch {
      iconsDir = dir;
    }
  }

  return { workspace: workspaceRoot, manifestPath, iconsDir, raw };
}

export async function extractJsonDump(
  jsonBuffer: Buffer,
  workspaceRoot: string,
): Promise<ExtractedDump> {
  await mkdir(workspaceRoot, { recursive: true });
  const manifestPath = path.join(workspaceRoot, 'dump.json');
  await pipeline(
    async function* () {
      yield jsonBuffer;
    },
    createWriteStream(manifestPath),
  );
  const raw = JSON.parse(jsonBuffer.toString('utf8')) as unknown;
  return {
    workspace: workspaceRoot,
    manifestPath,
    iconsDir: null,
    raw,
  };
}

export async function cleanupWorkspace(workspace: string): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
}

void createGunzip;
void createReadStream;
