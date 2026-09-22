import { Injectable, NotFoundException } from '@nestjs/common';

import type { UploadedImageFile } from '../../common/upload/uploaded-image.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { assertInScope, type BrandScope } from './admin-catalog.service';
import { menuBadRequest, menuConflict, menuNotFound } from './admin-menu.errors';
import { MAX_PRODUCT_IMAGES } from './dto/admin-product.dto';

export interface ProductImagesDto {
  /** In display order; the first one is the photo on the menu card. */
  imageUrls: string[];
}

/**
 * Product photos. `Product.imageUrls` is an ordered list whose first entry
 * is what customers see in the menu, so every change here is a
 * compare-and-set of the whole list: two tabs editing the same product
 * cannot silently undo each other's upload or reorder.
 */
@Injectable()
export class AdminProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async add(productId: string, image: UploadedImageFile, scope: BrandScope): Promise<ProductImagesDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { brandId: true, imageUrls: true, brand: { select: { slug: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    assertInScope(scope, product.brandId);
    // Checked before the upload too, so a full gallery does not leave an
    // orphaned file in the bucket for every attempt.
    if (product.imageUrls.length >= MAX_PRODUCT_IMAGES) throw tooManyImages();

    const { url } = await this.storage.uploadImage(
      `products/${product.brand.slug}`,
      image.filename,
      image.mimetype,
      image.buffer,
    );
    const imageUrls = await this.swap(productId, (current) => {
      if (current.length >= MAX_PRODUCT_IMAGES) throw tooManyImages();
      return [...current, url];
    });
    return { imageUrls };
  }

  /** Takes the photo off the product; the stored file itself is left alone. */
  async remove(productId: string, url: string, scope: BrandScope): Promise<ProductImagesDto> {
    const product = await this.load(productId, scope);
    if (!product.imageUrls.includes(url)) {
      throw menuNotFound('IMAGE_NOT_ON_PRODUCT', 'The product has no such photo');
    }
    const imageUrls = await this.swap(productId, (current) => current.filter((u) => u !== url));
    return { imageUrls };
  }

  /**
   * Puts the listed photos first, in that order; the rest keep their order
   * after them. So "make this the main photo" is a one-element list, and a
   * tab that has not seen a newer upload cannot drop it by reordering.
   */
  async reorder(productId: string, urls: readonly string[], scope: BrandScope): Promise<ProductImagesDto> {
    await this.load(productId, scope);
    const imageUrls = await this.swap(productId, (current) => {
      if (urls.some((u) => !current.includes(u))) {
        throw menuBadRequest('IMAGE_NOT_ON_PRODUCT', 'Only photos already on the product can be reordered');
      }
      return [...urls, ...current.filter((u) => !urls.includes(u))];
    });
    return { imageUrls };
  }

  private async load(productId: string, scope: BrandScope) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { brandId: true, imageUrls: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    assertInScope(scope, product.brandId);
    return product;
  }

  /** Applies `change` to the current list, retrying when someone else wrote in between. */
  private async swap(productId: string, change: (current: string[]) => string[]): Promise<string[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { imageUrls: true } });
      if (!product) throw new NotFoundException('Product not found');
      const current = product.imageUrls;
      const next = change(current);
      const { count } = await this.prisma.product.updateMany({
        where: {
          id: productId,
          imageUrls: current.length === 0 ? { isEmpty: true } : { equals: current },
        },
        data: { imageUrls: next },
      });
      if (count === 1) return next;
    }
    throw menuConflict('IMAGES_CHANGED', 'The photos of this product were changed at the same time; reload and retry');
  }
}

function tooManyImages() {
  return menuBadRequest('TOO_MANY_IMAGES', `A product can have at most ${MAX_PRODUCT_IMAGES} photos`);
}
