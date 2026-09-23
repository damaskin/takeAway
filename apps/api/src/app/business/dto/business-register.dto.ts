import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, Locale } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { E164_PATTERN, normalizePhone } from '../../common/text/phone';

export class BusinessRegisterDto {
  @ApiProperty({ example: 'Morning Brew Café', minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  brandName!: string;

  @ApiProperty({ example: 'Jane Smith', minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  ownerName!: string;

  @ApiProperty({ example: 'jane@morningbrew.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    example: '+37369123456',
    description: 'International format (E.164). Spaces, dashes and brackets are dropped; an empty value means none.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? normalizePhone(value) || undefined : value))
  @Matches(E164_PATTERN, { message: 'phone must be in international format, e.g. +37369123456' })
  phone?: string;

  /**
   * Required: a brand created in a currency nobody chose is what put Moldovan
   * cafés on USD price tags.
   */
  @ApiProperty({ enum: Currency, example: Currency.MDL, description: 'Currency of the menu and of payments' })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiProperty({ enum: Locale, example: Locale.RU, description: 'Language of the emails about this brand' })
  @IsEnum(Locale)
  locale!: Locale;
}
