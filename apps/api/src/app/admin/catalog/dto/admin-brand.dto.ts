import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Currency, Locale } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, IsUrl, Length } from 'class-validator';

import { IsInternationalPhone, ToPhone } from '../../../common/text/phone';

export class CreateBrandDto {
  @ApiProperty()
  @IsString()
  @Length(2, 60)
  slug!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ enum: Locale })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  /** The number the platform team calls the business on; normalised to E.164. */
  @ApiPropertyOptional({ example: '+37369123456', description: 'Normalised to E.164, like the sign-up phone.' })
  @ToPhone()
  @IsOptional()
  @IsInternationalPhone()
  contactPhone?: string;

  /**
   * Accepted and ignored. Brands used to recolour the Mini App with CSS
   * variables; since 2026-10-11 every brand shows in the one takeAway style
   * and nothing reads or writes `Brand.themeOverrides` (the column stays for
   * a rollback). Still allowed here so an admin tab opened before the
   * release, whose settings form sends it, can save.
   */
  @ApiPropertyOptional({ type: Object, deprecated: true, description: 'Ignored — brands no longer set colours.' })
  @IsOptional()
  @IsObject()
  themeOverrides?: Record<string, string>;
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
