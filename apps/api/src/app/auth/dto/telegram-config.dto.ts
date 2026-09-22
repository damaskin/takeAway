import { ApiProperty } from '@nestjs/swagger';

/**
 * Public bits of the Telegram bot that signs customer sign-ins. Native apps
 * open Telegram's OAuth page (`oauth.telegram.org/auth?bot_id=…`), which
 * needs the numeric bot id; the web widget only needs the username.
 */
export class TelegramConfigDto {
  @ApiProperty({ nullable: true, type: String, description: 'Numeric bot id; null when no bot is configured.' })
  botId!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Bot username without the @.' })
  botUsername!: string | null;
}
