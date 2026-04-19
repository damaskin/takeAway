import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Payload produced by the Telegram Login Widget
 * (https://core.telegram.org/widgets/login). The widget invokes
 * `window.onTelegramAuth(user)` on the page with these fields; the client
 * forwards them as-is to the API, which re-checks the `hash` against the
 * bot token (different signing scheme from the Mini App init-data path).
 */
export class TelegramWidgetAuthDto {
  @ApiProperty({ description: 'Telegram user id (numeric)' })
  @IsInt()
  id!: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  first_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photo_url?: string;

  @ApiProperty({ description: 'Unix seconds at which Telegram signed the payload' })
  @IsInt()
  auth_date!: number;

  @ApiProperty({ description: 'HMAC hex hash — verified against TELEGRAM_BOT_TOKEN' })
  @IsString()
  @MinLength(1)
  hash!: string;
}
