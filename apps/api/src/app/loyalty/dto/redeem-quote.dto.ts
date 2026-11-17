import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class RedeemQuoteRequestDto {
  @ApiProperty({
    description: 'Points the customer wants to spend, in units: a hundredth of a point (1 point = 1 currency unit).',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  points!: number;

  @ApiProperty({ description: 'What is still payable on the order, in cents, after any promo.', minimum: 0 })
  @IsInt()
  @Min(0)
  payableCents!: number;
}

/**
 * What the customer may actually spend, after the server clamps the ask to
 * their balance and to the order value. Points must never become a cash
 * refund, so the quote is authoritative and checkout renders what it says
 * rather than its own arithmetic.
 */
export class RedeemQuoteDto {
  @ApiProperty({ description: 'Units that will actually be burned. 0 when redemption is not possible.' })
  points!: number;

  @ApiProperty({ description: 'What those units are worth, in cents.' })
  discountCents!: number;

  @ApiProperty({ description: 'Balance available to this customer, in units.' })
  balance!: number;

  @ApiProperty({ description: 'Value of one unit, in cents (1: a point of 100 units is one currency unit).' })
  pointValueCents!: number;

  @ApiProperty({ description: 'Fewest units worth redeeming (100: one point).' })
  minPoints!: number;
}
