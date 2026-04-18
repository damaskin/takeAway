import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class TelegramAuthDto {
  @ApiProperty({
    description:
      'Raw `initData` query string from Telegram.WebApp.initData. We validate the HMAC against TELEGRAM_BOT_TOKEN.',
  })
  @IsString()
  @MinLength(1)
  initData!: string;
}
