import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { importPipeline } from './import-pipeline.js';

const QUEUE_NAME = 'palai-import';

let connection: Redis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): Redis {
  if (!connection) {
    connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getImportQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

export async function enqueueImportJob(jobId: string): Promise<void> {
  await getImportQueue().add(
    'import',
    { jobId },
    {
      jobId: `import-${jobId}`,
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 1,
    },
  );
}

export function startImportWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ jobId: string }>) => {
      const started = Date.now();
      const stats = await importPipeline.run(job.data.jobId);
      return { ...stats, durationMs: Date.now() - started };
    },
    { connection: getConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    console.error('Import worker failed', job?.id, err);
  });
  return worker;
}

export async function stopImportWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
