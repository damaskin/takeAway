import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

import { CARD_INSTITUTES } from '../agroprombank.config';

const INSTITUTE_CODES = CARD_INSTITUTES.map((i) => i.code);

export class BindCardDto {
  @ApiProperty({ description: 'Last four digits of the card', example: '0578' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'lastDigits must be exactly 4 digits' })
  lastDigits!: string;

  @ApiProperty({
    description: 'Mobile number the one-time password is sent to (8 digits), or the id of a prepaid card',
    example: '77712345',
  })
  @IsString()
  @Matches(/^[\d\s()-]{6,16}$/, { message: 'phone must be 6-12 digits' })
  phone!: string;

  @ApiProperty({ description: 'Issuer code', enum: INSTITUTE_CODES, example: '0001' })
  @IsIn(INSTITUTE_CODES)
  institute!: string;

  @ApiPropertyOptional({
    description: 'Cardholder name; the bank checks it against the card when supplied',
    example: 'Иванов Иван Иванович',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fio?: string;

  @ApiPropertyOptional({ description: 'Unbind every card previously bound by this customer', default: false })
  @IsOptional()
  @IsBoolean()
  deactivateOld?: boolean;

  @ApiPropertyOptional({ description: 'Customer-visible label for the card', example: 'Зарплатная' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

export class ConfirmBindingDto {
  @ApiProperty({ description: 'Six-digit one-time password from the SMS', example: '047805' })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'code must be 4-8 digits' })
  code!: string;
}

export class ChargeCardDto {
  @ApiProperty()
  @IsString()
  orderId!: string;

  @ApiProperty({ description: 'Id of a bound card from GET /payments/agroprombank/cards' })
  @IsString()
  cardId!: string;

  @ApiPropertyOptional({ description: 'Tip in minor units, charged on top of the order total', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  tipCents?: number;

  @ApiPropertyOptional({
    description: 'Hold the funds instead of capturing them; capture later with /complete',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  preauth?: boolean;
}

export class RefundOperationDto {
  @ApiProperty({ description: 'Amount to refund, in minor units', example: 247 })
  @IsInt()
  @Min(1)
  amountCents!: number;
}

export class CompletePreauthDto {
  @ApiProperty({
    description: 'Final amount to capture, in minor units. Up to 110% of the held amount.',
    example: 3300,
  })
  @IsInt()
  @Min(1)
  amountCents!: number;
}

export class CardInstituteDto {
  @ApiProperty({ example: '0001' })
  code!: string;

  @ApiProperty({ example: 'ЗАО «Агропромбанк»' })
  name!: string;
}

export class BoundCardDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, example: '9104 **** **** 1234' })
  maskedPan!: string | null;

  @ApiProperty({ nullable: true, example: 'MA*** *******' })
  embossing!: string | null;

  @ApiProperty({ nullable: true, example: '0001' })
  institute!: string | null;

  @ApiProperty({ nullable: true })
  instituteName!: string | null;

  @ApiProperty({ nullable: true })
  label!: string | null;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ nullable: true, description: '1 — active, -1 — inactive at the issuer' })
  cardState!: number | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ nullable: true })
  lastUsedAt!: string | null;
}

export class StartBindingResponseDto {
  @ApiProperty()
  bindingId!: string;

  @ApiProperty({ description: 'True when the bank issued the token immediately (prepaid cards)' })
  completed!: boolean;

  @ApiProperty({ type: BoundCardDto, nullable: true })
  card!: BoundCardDto | null;

  @ApiProperty({ description: 'When the one-time password stops being accepted' })
  expiresAt!: string;
}

export class ChargeResponseDto {
  @ApiProperty()
  paymentId!: string;

  @ApiProperty({ example: 'SUCCEEDED' })
  status!: string;

  @ApiProperty({ nullable: true, description: 'Operation id in the bank' })
  operationId!: string | null;

  @ApiProperty({ description: 'Merchant-side operation id sent to the bank as invoiceid' })
  invoiceId!: string;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty()
  tipCents!: number;

  @ApiProperty({ nullable: true, description: '1 — fully settled, 0 — partially settled composite transaction' })
  compositeStatus!: number | null;

  @ApiProperty({ nullable: true })
  authCode!: string | null;

  @ApiProperty({ nullable: true, description: 'Retrieval reference number in the payment system' })
  rrn!: string | null;
}
