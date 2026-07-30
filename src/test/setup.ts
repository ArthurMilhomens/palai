process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://palai:palai@localhost:5432/palai?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.OPENSEARCH_NODE =
  process.env.OPENSEARCH_NODE ?? 'http://localhost:9200';
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
process.env.S3_REGION = process.env.S3_REGION ?? 'us-east-1';
process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? 'palai';
process.env.S3_SECRET_ACCESS_KEY =
  process.env.S3_SECRET_ACCESS_KEY ?? 'palaisecret';
process.env.S3_BUCKET = process.env.S3_BUCKET ?? 'palai';
process.env.S3_PUBLIC_URL =
  process.env.S3_PUBLIC_URL ?? 'http://localhost:9000/palai';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ??
  'test-access-secret-change-me-in-production-32';
process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '15m';
process.env.REFRESH_TOKEN_TTL_DAYS = process.env.REFRESH_TOKEN_TTL_DAYS ?? '30';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? '1000';
process.env.RATE_LIMIT_TIME_WINDOW_MS =
  process.env.RATE_LIMIT_TIME_WINDOW_MS ?? '60000';
process.env.CACHE_TTL_SECONDS = process.env.CACHE_TTL_SECONDS ?? '60';
process.env.UPLOAD_MAX_BYTES = process.env.UPLOAD_MAX_BYTES ?? '10485760';
