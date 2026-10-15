import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SuggestionSource } from '@takeaway/shared-types';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** The most products a customer can hold in hand for one request — a long cart's lines. */
export const MAX_IN_HAND = 30;
export const DEFAULT_SUGGESTIONS = 6;
export const MAX_SUGGESTIONS = 12;

/** `a,b` and `?productIds=a&productIds=b` alike, as one list of trimmed ids. */
function splitIds({ value }: { value: unknown }): unknown {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  return parts.flatMap((part) =>
    typeof part === 'string'
      ? part
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : [part],
  );
}

export class SuggestionsQueryDto {
  @ApiPropertyOptional({
    type: String,
    description: "Products in hand, comma-separated ids: the cart's lines, or the product on screen",
    example: 'cm1latte,cm2croissant',
  })
  @IsOptional()
  @Transform(splitIds)
  @IsArray()
  @ArrayMaxSize(MAX_IN_HAND)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  productIds?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_SUGGESTIONS, default: DEFAULT_SUGGESTIONS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SUGGESTIONS)
  limit?: number;
}

export class StoreSuggestionsDto {
  @ApiProperty({
    type: [String],
    description: "Products of the store's menu, in stock, best first; none of those in hand. May be empty",
  })
  productIds!: string[];

  @ApiProperty({
    enum: ['copurchase', 'rule'],
    description:
      'copurchase: bought together with the products in hand in counted orders of the last 90 days (the ' +
      "store's, else the brand's) — the only case a client may say «Часто берут вместе». rule: not enough " +
      'orders yet, so bakery and food next to a drink, from the menu',
  })
  source!: SuggestionSource;
}
