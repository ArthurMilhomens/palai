import { prisma } from '../../prisma/client.js';
import { cacheFlushNamespace } from '../../shared/cache.js';
import { reindexGameVersion } from '../../indexers/opensearch.js';
import { NotFoundError } from '../../shared/errors.js';
import { importPipeline } from '../../jobs/import-pipeline.js';
import { enqueueImportJob } from '../../jobs/queue.js';

export class UpdatesService {
  async startImport(input: {
    version: string;
    build?: string | null;
    releaseDate?: Date | null;
    fileBuffer: Buffer;
    filename: string;
  }) {
    const { job } = await importPipeline.createJob(input);
    await enqueueImportJob(job.id);
    return job;
  }

  async reindexActive() {
    const active = await prisma.gameVersion.findFirst({
      where: { isActive: true },
    });
    if (!active) throw new NotFoundError('No active game version');
    const indexed = await reindexGameVersion(active.id);
    return { gameVersionId: active.id, indexed };
  }

  async clearCache() {
    const deleted = await cacheFlushNamespace('v1:');
    return { deleted };
  }

  async listVersions() {
    const versions = await prisma.gameVersion.findMany({
      orderBy: { importedAt: 'desc' },
      take: 20,
    });
    return {
      active: versions.find((v) => v.isActive) ?? null,
      versions,
    };
  }

  async getJob(id: string) {
    const job = await prisma.importJob.findUnique({
      where: { id },
      include: { steps: true, report: true, gameVersion: true },
    });
    if (!job) throw new NotFoundError('Import job not found');
    return job;
  }
}

export const updatesService = new UpdatesService();
