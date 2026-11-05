import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Every currency a card can be in — cards issued before RUP-only still carry the others. */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'IDR', 'MDL', 'RUP'] as const;

/** New cards are issued in Transnistrian rubles only (owner decision 2026-11-05). */
export const GIFT_CARD_ISSUE_CURRENCIES = ['RUP'] as const;

export class IssueGiftCardDto {
  @ApiProperty({ description: 'Card value in cents.' })
  @IsInt()
  @Min(1)
  amountCents!: number;

  @ApiProperty({ enum: GIFT_CARD_ISSUE_CURRENCIES, description: 'Gift cards are issued in RUP only.' })
  @IsIn(GIFT_CARD_ISSUE_CURRENCIES, { message: 'gift cards are issued in RUP only' })
  currency!: (typeof GIFT_CARD_ISSUE_CURRENCIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @ApiPropertyOptional({ description: 'ISO8601. When omitted the card never expires.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class GiftCardDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  brandId!: string;

  @ApiProperty()
  initialAmountCents!: number;

  @ApiProperty()
  balanceCents!: number;

  @ApiProperty({ enum: CURRENCIES })
  currency!: (typeof CURRENCIES)[number];

  @ApiProperty({ enum: ['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED'] })
  status!: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

  @ApiPropertyOptional({ nullable: true })
  recipientEmail!: string | null;

  @ApiPropertyOptional({ nullable: true })
  recipientName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  message!: string | null;

  @ApiPropertyOptional({ nullable: true })
  expiresAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class ValidateGiftCardDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ description: 'Cart id whose store/brand resolves the brand scope and currency.' })
  @IsString()
  @IsNotEmpty()
  cartId!: string;
}

export class GiftCardValidationDto {
  @ApiProperty()
  applicableCents!: number;

  @ApiProperty()
  remainingCents!: number;

  @ApiProperty({ enum: CURRENCIES })
  currency!: (typeof CURRENCIES)[number];
}
