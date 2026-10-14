import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** `POST /auth/email/start`: mail a sign-in code to this address. */
export class EmailLoginStartDto {
  @ApiProperty({ example: 'ivan@mail.ru', maxLength: 254 })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({
    example: 'ru',
    description:
      'Language of the email and of a profile created by this sign-in: `ru…` means Russian, anything else English.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}(?:[-_][A-Za-z0-9]{2,8})?$/, { message: 'locale must look like "ru" or "en-GB"' })
  locale?: string;
}

/** `POST /auth/email/verify`: the address and the six digits from the email. */
export class EmailLoginVerifyDto {
  @ApiProperty({ example: 'ivan@mail.ru', maxLength: 254 })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '042917', description: 'The six digits from the email' })
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

/** Which customer sign-in methods this deployment can complete. */
export class AuthMethodsDto {
  @ApiProperty({ description: 'Sign-in with a code sent by email; false until SMTP is configured on the server.' })
  email!: boolean;

  @ApiProperty({ description: 'Google ID tokens can be verified (GOOGLE_OAUTH_CLIENT_IDS is set).' })
  google!: boolean;

  @ApiProperty({ description: 'Apple ID tokens can be verified (APPLE_OAUTH_CLIENT_IDS is set).' })
  apple!: boolean;

  @ApiProperty({ description: 'Telegram Login (OpenID Connect) has a client id.' })
  telegram!: boolean;
}
