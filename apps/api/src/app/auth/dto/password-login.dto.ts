import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * `identifier` is what the person signs in with: an email, or the login an
 * owner gave someone invited without one. An email has an '@', a login
 * never does. `email` is the field this endpoint took before logins
 * existed; cached admin bundles and scripts still send it, so it stays as
 * an alias. When both are sent, `identifier` wins.
 */
export class PasswordLoginDto {
  @ApiPropertyOptional({
    example: 'admin@example.com',
    description: 'Email or staff login. Required unless the legacy `email` is sent.',
  })
  @ValidateIf((o: PasswordLoginDto) => o.identifier !== undefined || o.email === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier?: string;

  @ApiPropertyOptional({ example: 'admin@example.com', deprecated: true, description: 'Use `identifier`.' })
  @ValidateIf((o: PasswordLoginDto) => o.email !== undefined)
  @IsEmail()
  email?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
