import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AgroprombankQrCode,
  AgroprombankQrPaymentDto,
  AgroprombankQrPaymentStatus,
  AgroprombankQrStartRequest,
} from '@takeaway/shared-types';
import { IsString, MaxLength } from 'class-validator';

export class StartQrPaymentDto implements AgroprombankQrStartRequest {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  orderId!: string;
}

export class QrCodeDto implements AgroprombankQrCode {
  @ApiProperty({ description: 'Text to render as the QR code' })
  code!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Opens the bank's app with this invoice on the same phone; null when not configured",
  })
  appLink!: string | null;

  @ApiProperty({ description: 'ISO instant the invoice stops being offered' })
  expiresAt!: string;
}

export class QrPaymentResponseDto implements AgroprombankQrPaymentDto {
  @ApiProperty()
  paymentId!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty({
    enum: ['PENDING', 'PAID', 'EXPIRED', 'REFUNDED', 'FAILED'],
    description:
      'PENDING — waiting to be paid; PAID — the money is on the order (given back if the kitchen turns it down); ' +
      'EXPIRED — lapsed or closed unpaid; REFUNDED — paid, then given back; FAILED — the bank would not issue the invoice',
  })
  status!: AgroprombankQrPaymentStatus;

  @ApiProperty({ description: 'Minor units (kopecks)' })
  amountCents!: number;

  @ApiProperty({ enum: ['RUP'] })
  currency!: 'RUP';

  @ApiPropertyOptional({ type: QrCodeDto, nullable: true, description: 'While PENDING: what to show; null otherwise' })
  qr!: QrCodeDto | null;
}

/** Back-office view of a QR payment. */
export class QrPaymentAdminDto {
  @ApiProperty()
  paymentId!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ description: 'Our external id of the invoice (`extid`)' })
  invoiceId!: string;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty()
  refundedCents!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The bank's id of the payment" })
  qrPaymentId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'RRN of the card transaction' })
  rrn!: string | null;
}
