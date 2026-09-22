import { BadRequestException, Body, Controller, Get, NotFoundException, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { ImageUpload, UploadedImage, type UploadedImageFile } from '../common/upload/uploaded-image.decorator';
import { StorageService } from '../storage/storage.service';
import { UpdateBrandDto } from '../admin/catalog/dto/admin-brand.dto';

/**
 * Brand-settings endpoints for the admin panel's /settings screen.
 *
 * BRAND_ADMIN resolves to the brand they own (`Brand.ownerId`). SUPER_ADMIN
 * owns no brand of their own but the settings screen is part of their nav
 * too, so they pass the brand they're acting on as `?brandId=`; without it
 * we fall back to the single brand on the platform, which is what a
 * one-brand install always means.
 */
@ApiTags('brand-owner')
@ApiBearerAuth()
@Roles(Role.BRAND_ADMIN, Role.SUPER_ADMIN)
@Controller('my-brand')
export class BrandOwnerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string) {
    const { id } = await this.resolveBrand(user, brandId);
    return this.prisma.brand.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { stores: true, products: true } } },
    });
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBrandDto,
    @Query('brandId') brandId?: string,
  ) {
    const brand = await this.resolveBrand(user, brandId);

    // The owner cannot change their moderation status (that's what
    // SUPER_ADMIN is for) — and we lock the slug once assigned so the
    // storefront URL stays stable.
    const payload: Partial<{
      name: string;
      currency: import('@prisma/client').Currency;
      locale: import('@prisma/client').Locale;
      logoUrl: string;
      themeOverrides: Record<string, string>;
    }> = {};
    if (dto.name !== undefined) payload.name = dto.name;
    if (dto.currency !== undefined) payload.currency = dto.currency;
    if (dto.locale !== undefined) payload.locale = dto.locale;
    if (dto.logoUrl !== undefined) payload.logoUrl = dto.logoUrl;
    if (dto.themeOverrides !== undefined) {
      payload.themeOverrides = sanitizeThemeOverrides(dto.themeOverrides);
    }

    return this.prisma.brand.update({ where: { id: brand.id }, data: payload });
  }

  /**
   * Upload a new logo. Accepts a single `file` multipart field, stores it
   * via the shared StorageService, and writes the resulting public URL
   * into `Brand.logoUrl`.
   */
  @Post('logo')
  @ImageUpload()
  async uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedImage() file: UploadedImageFile,
    @Query('brandId') brandId?: string,
  ): Promise<{ logoUrl: string }> {
    const brand = await this.resolveBrand(user, brandId);

    const { url } = await this.storage.uploadImage(`brands/${brand.slug}`, file.filename, file.mimetype, file.buffer);
    await this.prisma.brand.update({ where: { id: brand.id }, data: { logoUrl: url } });
    return { logoUrl: url };
  }

  /**
   * The brand the caller is acting on, or a 404 explaining that there is
   * none — which is the honest answer for a fresh install with no brands
   * and for a BRAND_ADMIN whose brand was reassigned.
   */
  private async resolveBrand(
    user: AuthenticatedUser,
    brandId: string | undefined,
  ): Promise<{ id: string; slug: string }> {
    const select = { id: true, slug: true } as const;
    if (user.role === Role.SUPER_ADMIN) {
      const brand = brandId
        ? await this.prisma.brand.findUnique({ where: { id: brandId }, select })
        : await this.prisma.brand.findFirst({ orderBy: { name: 'asc' }, select });
      if (!brand) throw new NotFoundException(brandId ? 'Brand not found' : 'No brands exist yet');
      return brand;
    }
    const owned = await this.prisma.brand.findFirst({ where: { ownerId: user.id }, select });
    if (!owned) throw new NotFoundException('No brand for the current user');
    return owned;
  }
}

/**
 * Only allow keys that look like CSS variables and string values. Drops
 * everything else silently — no stack-trace-leaking error for a malformed
 * key, just omission, which keeps the PATCH call idempotent for sensible
 * inputs and mildly defensive against injected nonsense.
 */
function sanitizeThemeOverrides(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!k.startsWith('--')) continue;
    if (typeof v !== 'string') continue;
    if (v.length > 120) continue; // defensive cap
    out[k] = v;
  }
  if (Object.keys(out).length === 0 && Object.keys(input).length > 0) {
    throw new BadRequestException('themeOverrides must be a map of --css-var keys to string values');
  }
  return out;
}
