import type { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BRAND_LOGO_RULE } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { ImageUpload, sniffImageType, UploadedImageInterceptor } from './uploaded-image.decorator';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const AVIF = Buffer.from('\u0000\u0000\u0000\u001cftypavif', 'binary');

describe('sniffImageType', () => {
  it('recognises the raster formats we store by their magic numbers', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'binary'))).toBe('image/webp');
    expect(sniffImageType(AVIF)).toBe('image/avif');
  });

  it('refuses SVG and anything else, whatever name or type the client claims', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImageType(Buffer.from([]))).toBeNull();
  });
});

class Routes {
  @ImageUpload()
  product(): void {
    return undefined;
  }

  @ImageUpload(BRAND_LOGO_RULE)
  logo(): void {
    return undefined;
  }
}

describe('UploadedImageInterceptor', () => {
  const interceptor = new UploadedImageInterceptor(new Reflector());
  const next: CallHandler = { handle: () => of('handled') };

  /** A multipart request carrying `bytes`; `tooLarge` makes the parser hit its size limit. */
  function context(handler: () => void, bytes: Buffer, tooLarge = false) {
    const request: Record<string, unknown> = {
      isMultipart: () => true,
      file: jest.fn(async () => ({
        filename: 'photo',
        toBuffer: async () => {
          if (tooLarge) throw Object.assign(new Error('too large'), { code: 'FST_REQ_FILE_TOO_LARGE' });
          return bytes;
        },
      })),
    };
    const ctx = {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  async function refusal(promise: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    try {
      await promise;
    } catch (error) {
      const http = error as HttpException;
      return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> };
    }
    throw new Error('expected the upload to be refused');
  }

  it('reads the image and hands it to the route', async () => {
    const { ctx, request } = context(Routes.prototype.logo, PNG);
    await interceptor.intercept(ctx, next);
    expect(request['uploadedImage']).toEqual(expect.objectContaining({ mimetype: 'image/png', size: PNG.length }));
  });

  it("asks the parser for no more than the route's own limit", async () => {
    const { ctx, request } = context(Routes.prototype.logo, PNG);
    await interceptor.intercept(ctx, next);
    expect(request['file']).toHaveBeenCalledWith({ limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  });

  it('refuses an oversized logo with a code and the limit', async () => {
    const { ctx } = context(Routes.prototype.logo, PNG, true);
    expect(await refusal(interceptor.intercept(ctx, next))).toEqual({
      status: 413,
      body: expect.objectContaining({
        code: 'IMAGE_TOO_LARGE',
        maxBytes: 2 * 1024 * 1024,
        maxMb: 2,
        message: 'The image is larger than 2 MB',
      }),
    });
  });

  it('refuses AVIF where the route does not take it, but keeps it for product photos', async () => {
    const logo = context(Routes.prototype.logo, AVIF);
    expect(await refusal(interceptor.intercept(logo.ctx, next))).toEqual({
      status: 415,
      body: expect.objectContaining({ code: 'IMAGE_TYPE', message: 'Only JPEG, PNG or WebP images are accepted' }),
    });

    const product = context(Routes.prototype.product, AVIF);
    await interceptor.intercept(product.ctx, next);
    expect(product.request['uploadedImage']).toEqual(expect.objectContaining({ mimetype: 'image/avif' }));
  });

  it('keeps the old wording for the default limits', async () => {
    const big = context(Routes.prototype.product, PNG, true);
    expect((await refusal(interceptor.intercept(big.ctx, next))).body['message']).toBe('The image is larger than 5 MB');
    const svg = context(Routes.prototype.product, Buffer.from('<svg/>'));
    expect((await refusal(interceptor.intercept(svg.ctx, next))).body['message']).toBe(
      'Only JPEG, PNG, WebP or AVIF images are accepted',
    );
  });
});
