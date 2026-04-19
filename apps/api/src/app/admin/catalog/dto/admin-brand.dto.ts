import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Currency, Locale } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, IsUrl, Length } from 'class-validator';

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
