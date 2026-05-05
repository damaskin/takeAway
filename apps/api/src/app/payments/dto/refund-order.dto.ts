import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RefundOrderDto {
  @ApiPropertyOptional({
    description: 'Partial refund amount in cents. Omit (or send 0) to refund the full remaining balance.',
    example: 1500,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @ApiPropertyOptional({
    description: 'Stripe refund reason code. Free-form note goes in `note`.',
    enum: ['duplicate', 'fraudulent', 'requested_by_customer'],
  })
  @IsOptional()
  @IsEnum(['duplicate', 'fraudulent', 'requested_by_customer'])
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';

  @ApiPropertyOptional({
    description: 'Free-form admin note. Stored on the OrderEvent payload for the audit trail.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RefundOrderResponseDto {
  @ApiProperty({ description: 'Stripe refund id (re_...)' })
  refundId!: string;

  @ApiProperty({ description: 'Total refunded amount on this Payment after the call, in cents.' })
  refundedCents!: number;

  @ApiProperty({ description: 'Remaining refundable balance, in cents.' })
  remainingCents!: number;

  @ApiProperty({ enum: ['REFUNDED', 'PARTIALLY_REFUNDED'] })
  paymentStatus!: 'REFUNDED' | 'PARTIALLY_REFUNDED';
}
