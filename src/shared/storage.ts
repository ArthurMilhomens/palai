import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

let client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!client) {
    const cfg = env();
    client = new S3Client({
      region: cfg.S3_REGION,
      endpoint: cfg.S3_ENDPOINT,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: cfg.S3_ACCESS_KEY_ID,
        secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  const cfg = env();
  const s3 = getS3Client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: cfg.S3_BUCKET }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: cfg.S3_BUCKET }));
    } catch {
      // bucket may already exist or MinIO may not be up in tests
    }
  }
}

export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const cfg = env();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: cfg.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return toPublicAssetUrl(
    `${cfg.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`,
  ) as string;
}

/** Rewrite stored MinIO URLs (localhost:9000, host IP, etc.) to S3_PUBLIC_URL. */
export function toPublicAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const publicBase = env().S3_PUBLIC_URL.replace(/\/$/, '');
  const bucket = env().S3_BUCKET;
  const join = (key: string) => `${publicBase}/${key.replace(/^\//, '')}`;

  if (url.startsWith('/')) {
    const bucketPrefix = `/${bucket}/`;
    if (url.startsWith(bucketPrefix)) {
      return join(url.slice(bucketPrefix.length));
    }
    return url;
  }

  try {
    const parsed = new URL(url);
    const marker = `/${bucket}/`;
    const idx = parsed.pathname.indexOf(marker);
    if (idx >= 0) {
      return join(parsed.pathname.slice(idx + marker.length));
    }
  } catch {
    return url;
  }
  return url;
}
