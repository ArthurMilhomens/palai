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
  return `${cfg.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}
