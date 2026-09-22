import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Telegram Login (OpenID Connect) result: the ID token `oauth.telegram.org`
 * signed for our bot — from the web library's popup or the mobile apps'
 * code exchange. Re-verified here against Telegram's JWKS.
 */
export class TelegramIdTokenDto {
  @ApiProperty({ description: 'OpenID Connect ID token issued by oauth.telegram.org' })
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  idToken!: string;
}
