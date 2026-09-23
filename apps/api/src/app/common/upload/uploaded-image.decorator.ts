import {
  applyDecorators,
  BadRequestException,
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { Observable } from 'rxjs';

/** Largest image the API accepts: product photos, logos, store pictures. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

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
 * Reads the single image of a `multipart/form-data` request before the
 * handler runs. The API runs on Fastify, where Express's `FileInterceptor`
 * never sees a file — the old logo upload answered 415 to every request.
 * The type is sniffed from the first bytes: a client-declared content type
 * is just a string, and SVG (script-capable) is not accepted at all.
 */
@Injectable()
export class UploadedImageInterceptor implements NestInterceptor {
  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = ctx.switchToHttp().getRequest<MultipartRequest>();
    if (!request.isMultipart()) {
      throw new BadRequestException('Send the image as multipart/form-data');
    }

    const part = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
    if (!part) throw new BadRequestException('No image in the request');

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new PayloadTooLargeException('The image is larger than 5 MB');
      }
      throw error;
    }

    const mimetype = sniffImageType(buffer);
    if (!mimetype) {
      throw new UnsupportedMediaTypeException('Only JPEG, PNG, WebP or AVIF images are accepted');
    }
    request.uploadedImage = { filename: part.filename || 'image', mimetype, buffer, size: buffer.length };
    return next.handle();
  }
}

/** Marks a route as taking one image upload in a `file` field. */
export function ImageUpload(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseInterceptors(UploadedImageInterceptor),
    ApiConsumes('multipart/form-data'),
    ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } }),
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
