import { buildApp } from './app.js';
import { loadEnv, env } from './config/env.js';
import { connectRedis } from './shared/cache.js';
import { ensureBucket } from './shared/storage.js';
import { authService } from './modules/auth/service.js';
import { startImportWorker, stopImportWorker } from './jobs/queue.js';
import { prisma } from './prisma/client.js';

async function main() {
  loadEnv();
  const cfg = env();

  await connectRedis();
  await ensureBucket().catch((err) => {
    console.warn('S3 bucket check failed (continuing):', err);
  });
  await authService.bootstrapAdmin();

  const app = await buildApp();
  startImportWorker();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await stopImportWorker();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  app.log.info(`Palai API listening on ${cfg.HOST}:${cfg.PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
