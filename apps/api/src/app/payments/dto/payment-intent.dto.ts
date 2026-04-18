import { ApiProperty } from '@nestjs/swagger';

export class PaymentIntentResponseDto {
  @ApiProperty({ description: 'Stripe PaymentIntent client_secret for use by the frontend SDK' })
  clientSecret!: string;
}
