import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';

import { RETURN_TARGETS, type ReturnTarget } from '../constants';

export class StartWebPaymentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  orderId!: string;

  @ApiProperty({
    enum: RETURN_TARGETS,
    description: 'Client the customer pays from — where the bank sends them back afterwards',
  })
  @IsIn(RETURN_TARGETS)
  returnTo!: ReturnTarget;
}

export class PaymentPageDto {
  @ApiProperty({ enum: ['POST'] })
  method!: 'POST';

  @ApiProperty({ description: 'Bank page to POST the fields to' })
  action!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Form fields, signed; post them unchanged',
  })
  fields!: Record<string, string>;

  @ApiProperty({ description: 'The same request as a GET link — for in-app browsers' })
  url!: string;
}

export class StartWebPaymentResponseDto {
  @ApiProperty()
  paymentId!: string;

  @ApiProperty({ description: 'Our invoice id at the bank (`nivid`)' })
  invoiceId!: string;

  @ApiProperty({ enum: ['PENDING', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] })
  status!: string;

  @ApiPropertyOptional({
    type: PaymentPageDto,
    nullable: true,
    description: 'Where to send the customer; null when the order is already held or paid',
  })
  page!: PaymentPageDto | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'When the bank page stops taking this invoice' })
  expiresAt!: string | null;
}

export class WebPaymentDto {
  @ApiProperty()
  paymentId!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  invoiceId!: string;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty()
  refundedCents!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  rrn!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastDigits!: string | null;
}
