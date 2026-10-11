import { ApiProperty } from '@nestjs/swagger';
import { Currency, Locale } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import { IsInternationalPhone, ToPhone } from '../../common/text/phone';

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

  /**
   * Required: the platform team calls the businesses that signed up and
   * never launched. Stored on the brand as its contact phone.
   */
  @ApiProperty({
    example: '+37369123456',
    description:
      'Normalised to E.164: separators are dropped; Moldovan (0XX XXX XXX), Ukrainian (0XX XXX XXXX) and ' +
      'Russian (8 XXX XXX-XX-XX) local formats are read; any other country needs its code.',
  })
  @ToPhone()
  @IsNotEmpty({ message: 'phone is required' })
  @IsInternationalPhone()
  phone!: string;

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
