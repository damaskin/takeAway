import { ApiProperty } from '@nestjs/swagger';

/**
 * Public bits of the Telegram bot that signs customers in. Telegram Login
 * (OpenID Connect) needs the client id — the bot's numeric id — to open its
 * authorization page; the legacy web widget needs the username.
 */
export class TelegramConfigDto {
  @ApiProperty({ nullable: true, type: String, description: 'Numeric bot id; null when no bot is configured.' })
  botId!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Bot username without the @.' })
  botUsername!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Telegram Login (OpenID Connect) client id; null when Telegram Login is not configured.',
  })
  clientId!: string | null;
}
