import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PasswordForgotResponse, PasswordResetChannel } from '@takeaway/shared-types';
import { IsEmail, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * `identifier` is what the person signs in with: an email, or the login an
 * owner gave someone invited without one — the same as the password login
 * takes. `email` is the field this endpoint took before logins could ask
 * for a link; cached admin bundles still send it, so it stays as an alias.
 * When both are sent, `identifier` wins.
 */
export class PasswordForgotDto {
  @ApiPropertyOptional({
    example: 'admin@example.com',
    description: 'Email or staff login. Required unless the legacy `email` is sent.',
  })
  @ValidateIf((o: PasswordForgotDto) => o.identifier !== undefined || o.email === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier?: string;

  @ApiPropertyOptional({ example: 'admin@example.com', deprecated: true, description: 'Use `identifier`.' })
  @ValidateIf((o: PasswordForgotDto) => o.email !== undefined)
  @IsEmail()
  email?: string;
}

const CHANNELS: PasswordResetChannel[] = ['email', 'telegram'];

/** Same for every identifier: what the server can send through, never what the account has. */
export class PasswordForgotResponseDto implements PasswordForgotResponse {
  @ApiProperty({
    enum: CHANNELS,
    isArray: true,
    description: 'Ways this server delivers reset links: email (SMTP) and the Telegram bot',
  })
  channels!: PasswordResetChannel[];

  @ApiProperty({ example: 60, description: 'How long the link works' })
  linkTtlMinutes!: number;
}
