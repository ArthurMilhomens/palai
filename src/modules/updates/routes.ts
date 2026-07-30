import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { requireRole } from '../auth/controller.js';
import { prisma } from '../../prisma/client.js';
import { importPipeline } from '../../jobs/import-pipeline.js';
import { reindexGameVersion } from '../../indexers/opensearch.js';
import { cacheFlushNamespace } from '../../shared/cache.js';
import { env } from '../../config/env.js';
import { ValidationError, NotFoundError } from '../../shared/errors.js';
import { enqueueImportJob } from '../../jobs/queue.js';

export async function updatesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole(Role.ADMIN));

  app.post('/import', {
    schema: {
      tags: ['Updates'],
      summary: 'Upload a game data dump and start import pipeline',
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
    },
    handler: async (req, reply) => {
      const file = await req.file();
      if (!file) throw new ValidationError('file is required');

      const max = env().UPLOAD_MAX_BYTES;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of file.file) {
        size += chunk.length;
        if (size > max) {
          throw new ValidationError(`File exceeds max size of ${max} bytes`);
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const fields = file.fields as Record<
        string,
        { value?: string } | undefined
      >;
      const version =
        (typeof fields.version?.value === 'string' && fields.version.value) ||
        undefined;
      const build =
        (typeof fields.build?.value === 'string' && fields.build.value) ||
        null;
      const releaseDateRaw =
        (typeof fields.releaseDate?.value === 'string' &&
          fields.releaseDate.value) ||
        null;

      // Allow version from JSON dump if not provided in form
      let resolvedVersion = version;
      if (!resolvedVersion && file.filename.endsWith('.json')) {
        try {
          const parsed = JSON.parse(buffer.toString('utf8')) as { version?: string };
          resolvedVersion = parsed.version;
        } catch {
          // ignore
        }
      }
      if (!resolvedVersion) {
        throw new ValidationError('version field is required');
      }

      const { job } = await importPipeline.createJob({
        version: resolvedVersion,
        build,
        releaseDate: releaseDateRaw ? new Date(releaseDateRaw) : null,
        fileBuffer: buffer,
        filename: file.filename,
      });

      await enqueueImportJob(job.id);
      req.log.info(
        { jobId: job.id, version: resolvedVersion },
        'Import job enqueued',
      );

      return reply.status(202).send({
        data: {
          jobId: job.id,
          status: job.status,
          version: resolvedVersion,
          build,
        },
      });
    },
  });

  app.post('/index', {
    schema: {
      tags: ['Updates'],
      summary: 'Reindex active game version into OpenSearch',
      security: [{ bearerAuth: [] }],
    },
    handler: async (_req, reply) => {
      const active = await prisma.gameVersion.findFirst({
        where: { isActive: true },
      });
      if (!active) throw new NotFoundError('No active game version');
      const count = await reindexGameVersion(active.id);
      return reply.send({ data: { gameVersionId: active.id, indexed: count } });
    },
  });

  app.post('/cache/clear', {
    schema: {
      tags: ['Updates'],
      summary: 'Flush Redis API cache namespace',
      security: [{ bearerAuth: [] }],
    },
    handler: async (_req, reply) => {
      const deleted = await cacheFlushNamespace('v1:');
      return reply.send({ data: { deleted } });
    },
  });

  app.get('/version', {
    schema: {
      tags: ['Updates'],
      summary: 'Get active and recent game versions',
      security: [{ bearerAuth: [] }],
    },
    handler: async (_req, reply) => {
      const versions = await prisma.gameVersion.findMany({
        orderBy: { importedAt: 'desc' },
        take: 20,
      });
      return reply.send({
        data: {
          active: versions.find((v) => v.isActive) ?? null,
          versions,
        },
      });
    },
  });

  app.get('/jobs/:id', {
    schema: {
      tags: ['Updates'],
      summary: 'Get import job status and report',
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const params = z.object({ id: z.string() }).parse(req.params);
      const job = await prisma.importJob.findUnique({
        where: { id: params.id },
        include: { steps: true, report: true, gameVersion: true },
      });
      if (!job) throw new NotFoundError('Import job not found');
      return reply.send({ data: job });
    },
  });

  app.post('/jobs/:id/resume', {
    schema: {
      tags: ['Updates'],
      summary: 'Resume a failed import job',
      security: [{ bearerAuth: [] }],
    },
    handler: async (req, reply) => {
      const params = z.object({ id: z.string() }).parse(req.params);
      const job = await prisma.importJob.findUnique({ where: { id: params.id } });
      if (!job) throw new NotFoundError('Import job not found');
      await enqueueImportJob(job.id);
      return reply.status(202).send({ data: { jobId: job.id, resumed: true } });
    },
  });
}
