import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { UploadedImageFile } from '../../common/upload/uploaded-image.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../../storage/storage.service';
import { AdminProductImagesService } from './admin-product-images.service';

const PHOTO: UploadedImageFile = {
  filename: 'latte.jpg',
  mimetype: 'image/jpeg',
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  size: 4,
};

function url(n: number): string {
  return `https://cdn.example/products/noname/${n}.jpg`;
}

/**
 * A product row whose `imageUrls` only changes through a compare-and-set,
 * the way the service writes it.
 */
function build(initial: string[], brandId = 'b1') {
  let imageUrls = [...initial];
  const prisma = {
    product: {
      findUnique: jest.fn(() => Promise.resolve({ brandId, imageUrls: [...imageUrls], brand: { slug: 'noname' } })),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { imageUrls: { equals?: string[]; isEmpty?: boolean } };
          data: { imageUrls: string[] };
        }) => {
          const matches = where.imageUrls.isEmpty
            ? imageUrls.length === 0
            : JSON.stringify(where.imageUrls.equals) === JSON.stringify(imageUrls);
          if (matches) imageUrls = [...data.imageUrls];
          return Promise.resolve({ count: matches ? 1 : 0 });
        },
      ),
    },
  };
  const storage = { uploadImage: jest.fn().mockResolvedValue({ url: url(99), key: 'k' }) };
  const svc = new AdminProductImagesService(prisma as unknown as PrismaService, storage as unknown as StorageService);
  return {
    svc,
    prisma,
    storage,
    stored: () => imageUrls,
    /** Someone else appends `extra` right after the given reads (1-based), before our write lands. */
    raceAfterReads(extra: string, reads: number[]) {
      let read = 0;
      prisma.product.findUnique.mockImplementation(() => {
        const snapshot = { brandId, imageUrls: [...imageUrls], brand: { slug: 'noname' } };
        if (reads.includes(++read)) imageUrls = [...imageUrls, extra];
        return Promise.resolve(snapshot);
      });
    },
  };
}

describe('AdminProductImagesService', () => {
  it("stores a photo under the brand's folder and appends it", async () => {
    const { svc, storage, stored } = build([url(1)]);

    const result = await svc.add('p1', PHOTO, ['b1']);

    expect(storage.uploadImage).toHaveBeenCalledWith('products/noname', 'latte.jpg', 'image/jpeg', PHOTO.buffer);
    expect(result.imageUrls).toEqual([url(1), url(99)]);
    expect(stored()).toEqual([url(1), url(99)]);
  });

  it('writes the first photo of an empty product', async () => {
    const { svc, prisma, stored } = build([]);

    await svc.add('p1', PHOTO, ['b1']);

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', imageUrls: { isEmpty: true } },
      data: { imageUrls: [url(99)] },
    });
    expect(stored()).toEqual([url(99)]);
  });

  it('refuses a seventh photo before uploading anything', async () => {
    const { svc, storage } = build([1, 2, 3, 4, 5, 6].map(url));

    const err = await svc.add('p1', PHOTO, ['b1']).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'TOO_MANY_IMAGES' });
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it("refuses another brand's product before uploading anything", async () => {
    const { svc, storage } = build([], 'rival');

    await expect(svc.add('p1', PHOTO, ['b1'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it('keeps a photo uploaded from another tab at the same moment', async () => {
    const { svc, prisma, raceAfterReads, stored } = build([url(1)]);
    // Read 1 is the up-front check; read 2 is the one the write is based on.
    raceAfterReads(url(2), [2]);

    await svc.add('p1', PHOTO, ['b1']);

    expect(prisma.product.updateMany).toHaveBeenCalledTimes(2);
    expect(stored()).toEqual([url(1), url(2), url(99)]);
  });

  it('gives up with 409 IMAGES_CHANGED when the list keeps changing under it', async () => {
    const { svc, raceAfterReads } = build([url(1)]);
    raceAfterReads(url(2), [2, 3, 4]);

    const err = await svc.add('p1', PHOTO, ['b1']).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'IMAGES_CHANGED' });
  });

  it('removes one photo and keeps the order of the rest', async () => {
    const { svc } = build([url(1), url(2), url(3)]);

    const result = await svc.remove('p1', url(2), ['b1']);

    expect(result.imageUrls).toEqual([url(1), url(3)]);
  });

  it('answers 404 for a photo the product does not have', async () => {
    const { svc } = build([url(1)]);

    const err = await svc.remove('p1', url(7), ['b1']).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'IMAGE_NOT_ON_PRODUCT' });
  });

  it('makes a photo the main one by listing it alone', async () => {
    const { svc } = build([url(1), url(2), url(3)]);

    const result = await svc.reorder('p1', [url(3)], ['b1']);

    expect(result.imageUrls).toEqual([url(3), url(1), url(2)]);
  });

  it('refuses to reorder in a photo that is not on the product', async () => {
    const { svc, stored } = build([url(1), url(2)]);

    await expect(svc.reorder('p1', [url(2), 'https://elsewhere.example/x.jpg'], ['b1'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(stored()).toEqual([url(1), url(2)]);
  });
});
