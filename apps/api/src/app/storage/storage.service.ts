import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const IMAGE_MIME_PREFIX = 'image/';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Thin wrapper over S3-compatible object storage (AWS S3, MinIO, Backblaze,
 * DigitalOcean Spaces, etc.). Reads config from:
 *   S3_ENDPOINT     — e.g. http://minio:9000 (omit for real AWS).
 *   S3_REGION       — default us-east-1.
 *   S3_ACCESS_KEY   — IAM / bucket credentials.
 *   S3_SECRET_KEY
 *   S3_BUCKET       — target bucket, must exist and be public-read.
 *   S3_PUBLIC_URL_BASE — the URL prefix the public uses to read the object
 *                        (e.g. https://cdn.takeaway.million-sales.ru or
 *                         https://<bucket>.s3.<region>.amazonaws.com).
 *                        If omitted, falls back to `${S3_ENDPOINT}/${S3_BUCKET}`.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;
  private bucket: string | null = null;
  private publicBase = '';

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT') || undefined;
    const region = this.config.get<string>('S3_REGION') || 'us-east-1';
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY');
    const bucket = this.config.get<string>('S3_BUCKET');
    if (!accessKeyId || !secretAccessKey || !bucket) {
      this.logger.warn('S3 credentials incomplete — StorageService will refuse uploads.');
      return;
    }
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: !!endpoint, // MinIO defaults to path-style; AWS auto-picks vhost.
      credentials: { accessKeyId, secretAccessKey },
    });
    const explicit = this.config.get<string>('S3_PUBLIC_URL_BASE');
    if (explicit) {
      this.publicBase = explicit.replace(/\/$/, '');
    } else if (endpoint) {
      this.publicBase = `${endpoint.replace(/\/$/, '')}/${bucket}`;
    } else {
      this.publicBase = `https://${bucket}.s3.${region}.amazonaws.com`;
    }
  }

  /**
   * Upload raw bytes with a generated key prefixed by `folder`. Returns the
   * public URL. Rejects non-image content-types and files over 5 MB.
   */
  async uploadImage(
    folder: string,
    originalName: string,
    contentType: string,
    body: Buffer,
  ): Promise<{ url: string; key: string }> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException('Object storage is not configured on this deployment');
    }
    if (!contentType.startsWith(IMAGE_MIME_PREFIX)) {
      throw new ServiceUnavailableException(`Unsupported content-type: ${contentType}`);
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      throw new ServiceUnavailableException(`File too large: ${body.length} bytes`);
    }
    const ext = extname(originalName).toLowerCase() || mimeToExt(contentType);
    const key = `${folder.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return { url: `${this.publicBase}/${key}`, key };
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/svg+xml':
      return '.svg';
    case 'image/avif':
      return '.avif';
    default:
      return '';
  }
}
