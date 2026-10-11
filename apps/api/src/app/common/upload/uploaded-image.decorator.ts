import {
  applyDecorators,
  BadRequestException,
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
  SetMetadata,
  UnsupportedMediaTypeException,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { ImageMimeType } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

export type { ImageMimeType };

/** Largest image the API accepts anywhere: product photos, logos, store pictures. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** What one upload route takes. Stricter rules live in `@takeaway/shared-types` (STORE_PHOTO_RULE, …). */
export interface ImageLimits {
  maxBytes: number;
  types: readonly ImageMimeType[];
}

/** Every raster format we store — product photos still take AVIF. */
export const ANY_IMAGE: ImageLimits = {
  maxBytes: MAX_IMAGE_BYTES,
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
};

const IMAGE_LIMITS = 'uploadedImageLimits';

const FORMAT_NAMES: Record<ImageMimeType, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
};

export interface UploadedImageFile {
  filename: string;
  /** Detected from the bytes, not taken from the client. */
  mimetype: ImageMimeType;
  buffer: Buffer;
  size: number;
}

/**
 * The parts of a Fastify request that `@fastify/multipart` adds (registered
 * in main.ts). Declared here because pnpm keeps `fastify` itself out of the
 * API's direct imports.
 */
interface MultipartRequest {
  isMultipart(): boolean;
  file(options?: {
    limits?: { fileSize?: number; files?: number };
  }): Promise<{ filename: string; toBuffer(): Promise<Buffer> } | undefined>;
  uploadedImage?: UploadedImageFile;
}

/**
 * 413 with a stable `code` and the limit, so a client can say "larger than
 * 2 MB" in its own language. The message keeps the wording older admin
 * builds match on.
 */
export function imageTooLarge(maxBytes: number): PayloadTooLargeException {
  const maxMb = Math.floor(maxBytes / (1024 * 1024));
  return new PayloadTooLargeException({
    statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
    error: 'Payload Too Large',
    code: 'IMAGE_TOO_LARGE',
    message: `The image is larger than ${maxMb} MB`,
    maxBytes,
    maxMb,
  });
}

/** 415 with a stable `code` and the accepted types. */
export function imageTypeRefused(types: readonly ImageMimeType[]): UnsupportedMediaTypeException {
  return new UnsupportedMediaTypeException({
    statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    error: 'Unsupported Media Type',
    code: 'IMAGE_TYPE',
    message: `Only ${listFormats(types)} images are accepted`,
    types,
  });
}

/** "JPEG, PNG, WebP or AVIF". */
function listFormats(types: readonly ImageMimeType[]): string {
  const names = types.map((t) => FORMAT_NAMES[t]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? '');
}

/**
 * Reads the single image of a `multipart/form-data` request before the
 * handler runs. The API runs on Fastify, where Express's `FileInterceptor`
 * never sees a file — the old logo upload answered 415 to every request.
 * The type is sniffed from the first bytes: a client-declared content type
 * is just a string, and SVG (script-capable) is not accepted at all. Size
 * and formats come from the route's {@link ImageUpload} limits.
 */
@Injectable()
export class UploadedImageInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const limits = this.reflector.get<ImageLimits | undefined>(IMAGE_LIMITS, ctx.getHandler()) ?? ANY_IMAGE;
    const request = ctx.switchToHttp().getRequest<MultipartRequest>();
    if (!request.isMultipart()) {
      throw new BadRequestException('Send the image as multipart/form-data');
    }

    const part = await request.file({ limits: { fileSize: limits.maxBytes, files: 1 } });
    if (!part) throw new BadRequestException('No image in the request');

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw imageTooLarge(limits.maxBytes);
      throw error;
    }
    // Belt and braces: a parser that truncates instead of throwing must not
    // let an oversized file through either.
    if (buffer.length > limits.maxBytes) throw imageTooLarge(limits.maxBytes);

    const mimetype = sniffImageType(buffer);
    if (!mimetype || !limits.types.includes(mimetype)) throw imageTypeRefused(limits.types);
    request.uploadedImage = { filename: part.filename || 'image', mimetype, buffer, size: buffer.length };
    return next.handle();
  }
}

/**
 * Marks a route as taking one image upload in a `file` field, within
 * `limits` (any stored format up to 5 MB when omitted).
 */
export function ImageUpload(limits: ImageLimits = ANY_IMAGE): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(IMAGE_LIMITS, limits),
    UseInterceptors(UploadedImageInterceptor),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      description: `One image, ${listFormats(limits.types)}, up to ${Math.floor(limits.maxBytes / (1024 * 1024))} MB`,
      schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
    }),
  );
}

/** The image read by {@link ImageUpload}. */
export const UploadedImage = createParamDecorator((_data: unknown, ctx: ExecutionContext): UploadedImageFile => {
  const image = ctx.switchToHttp().getRequest<MultipartRequest>().uploadedImage;
  if (!image) throw new BadRequestException('No image in the request');
  return image;
});

/** Magic numbers of the formats we store. */
export function sniffImageType(bytes: Buffer): ImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}
