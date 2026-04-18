import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty()
  @IsString()
  orderId!: string;
}
