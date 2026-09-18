import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Sign-in payload for Google and Apple. Both providers hand the client a
 * signed OpenID Connect ID token; we forward it verbatim and re-verify it
 * server-side against the provider's JWKS.
 *
 * `name` exists for Apple only. Apple returns the user's name exactly once
 * — in the client-side authorization response of the very first consent,
 * never in the token itself — so the client passes it through on that first
 * call or we lose it forever. Google carries the name in the token and
 * ignores this field.
 */
export class OAuthLoginDto {
  @ApiProperty({ description: 'OpenID Connect ID token issued by the provider' })
  @IsString()
  @MinLength(1)
  idToken!: string;

  @ApiPropertyOptional({ description: 'Display name — Apple first-consent only' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
