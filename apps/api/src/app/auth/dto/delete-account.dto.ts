import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Optional body of `DELETE /auth/me`; the request works without one.
 *
 * Apple requires apps offering Sign in with Apple to revoke the user's Apple
 * tokens on deletion. We do not keep those tokens, so the iOS app runs Sign
 * in with Apple again just before deleting and forwards the fresh
 * authorization code for the server to exchange and revoke.
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({
    description:
      'Fresh Sign in with Apple authorization code (iOS, accounts with an Apple identity) — used to revoke the Apple grant',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  appleAuthorizationCode?: string;
}
