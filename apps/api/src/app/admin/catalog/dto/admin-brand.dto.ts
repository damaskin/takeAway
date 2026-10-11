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
   * CSS-variable overrides applied on top of the Telegram theme in TMA.
   * Shape: `{ "--color-caramel": "#aabb00", "--color-foam": "#ffffff" }`.
   * Only `--*` keys with string values are accepted server-side.
   */
  @ApiPropertyOptional({ type: Object, description: 'CSS-variable overrides for brand theming.' })
  @IsOptional()
  @IsObject()
  themeOverrides?: Record<string, string>;
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
