import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateBrandDto } from '../admin/catalog/dto/admin-brand.dto';

/**
 * BRAND_ADMIN-scoped endpoints that resolve the brand via
 * `Brand.ownerId = currentUser.id`. SUPER_ADMIN continues to use the
 * unscoped /admin/brands/* routes and can act on any brand.
 */
@ApiTags('brand-owner')
@ApiBearerAuth()
@Roles(Role.BRAND_ADMIN)
@Controller('my-brand')
export class BrandOwnerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    const brand = await this.prisma.brand.findFirst({
      where: { ownerId: user.id },
      include: { _count: { select: { stores: true, products: true } } },
    });
    if (!brand) throw new NotFoundException('No brand for the current user');
    return brand;
  }

  @Patch()
  async update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBrandDto) {
    const brand = await this.prisma.brand.findFirst({ where: { ownerId: user.id }, select: { id: true } });
    if (!brand) throw new NotFoundException('No brand for the current user');

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
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
  ): Promise<{ logoUrl: string }> {
    if (!file) throw new BadRequestException('`file` field is required');
    const brand = await this.prisma.brand.findFirst({ where: { ownerId: user.id }, select: { id: true, slug: true } });
    if (!brand) throw new NotFoundException('No brand for the current user');

    const { url } = await this.storage.uploadImage(
      `brands/${brand.slug}`,
      file.originalname,
      file.mimetype,
      file.buffer,
    );
    await this.prisma.brand.update({ where: { id: brand.id }, data: { logoUrl: url } });
    return { logoUrl: url };
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
