/**
 * Import local game_data/dump.zip without HTTP size limits.
 * Usage: npx tsx scripts/import-local-dump.ts
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';
import { importPipeline } from '../src/jobs/import-pipeline.js';
import { prisma } from '../src/prisma/client.js';
import { ensureBucket } from '../src/shared/storage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  loadEnv(process.env);
  await ensureBucket().catch(() => undefined);

  const zipPath = path.join(root, 'game_data', 'dump.zip');
  const infoPath = path.join(root, 'game_data', 'game-info.json');
  const buf = await readFile(zipPath);

  let build = 'unknown';
  try {
    const info = JSON.parse(await readFile(infoPath, 'utf8')) as {
      BuildId?: string;
      buildId?: string;
    };
    build = info.BuildId ?? info.buildId ?? build;
  } catch {
    // ignore
  }

  console.log(`Importando ${zipPath} (${(buf.length / 1e6).toFixed(1)} MB), build=${build}`);

  const { job } = await importPipeline.createJob({
    version: 'palworld',
    build,
    fileBuffer: buf,
    filename: 'dump.zip',
  });

  console.log(`Job ${job.id} criado — executando pipeline...`);
  const stats = await importPipeline.run(job.id);
  console.log('Concluído:', JSON.stringify(stats, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
