import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class RedeemQuoteRequestDto {
  @ApiProperty({ description: 'Points the customer wants to spend.', minimum: 0 })
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
  @ApiProperty({ description: 'Points that will actually be burned. 0 when redemption is not possible.' })
  points!: number;

  @ApiProperty({ description: 'What those points are worth, in cents.' })
  discountCents!: number;

  @ApiProperty({ description: 'Balance available to this customer.' })
  balance!: number;

  @ApiProperty({ description: 'Value of one point, in cents.' })
  pointValueCents!: number;

  @ApiProperty({ description: 'Fewest points worth redeeming.' })
  minPoints!: number;
}
