import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { UpdateBrandDto } from '../admin/catalog/dto/admin-brand.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ImageUpload, UploadedImage, type UploadedImageFile } from '../common/upload/uploaded-image.decorator';
import { BrandOwnerService } from './brand-owner.service';
import { BrandOnboardingDto } from './dto/brand-onboarding.dto';

/**
 * The owner's own brand, for the admin panel's /settings screen and the
 * dashboard's launch checklist.
 *
 * Every route takes the brand picked in the admin header as `?brandId=`;
 * see {@link BrandOwnerService} for how it is checked and what happens
 * without one. SUPER_ADMIN is allowed in because /settings is in their nav
 * too — they edit whichever brand they are looking at.
 */
@ApiTags('brand-owner')
@ApiBearerAuth()
@Roles(Role.BRAND_ADMIN, Role.SUPER_ADMIN)
@Controller('my-brand')
export class BrandOwnerController {
  constructor(private readonly brands: BrandOwnerService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string) {
    return this.brands.get(user, brandId);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBrandDto, @Query('brandId') brandId?: string) {
    return this.brands.update(user, dto, brandId);
  }

  /**
   * Upload a new logo. Accepts a single `file` multipart field, stores it
   * via the shared StorageService, and writes the resulting public URL
   * into `Brand.logoUrl`.
   */
  @Post('logo')
  @ImageUpload()
  uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedImage() file: UploadedImageFile,
    @Query('brandId') brandId?: string,
  ): Promise<{ logoUrl: string }> {
    return this.brands.uploadLogo(user, file, brandId);
  }

  @Get('onboarding')
  @ApiOkResponse({ type: BrandOnboardingDto })
  onboarding(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string): Promise<BrandOnboardingDto> {
    return this.brands.onboarding(user, brandId);
  }

  /** A rejected brand goes back into the review queue. The owner's call, not the platform's. */
  @Post('resubmit')
  @Roles(Role.BRAND_ADMIN)
  @HttpCode(HttpStatus.OK)
  resubmit(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string) {
    return this.brands.resubmit(user, brandId);
  }
}
