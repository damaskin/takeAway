import { ApiProperty } from '@nestjs/swagger';
import { Currency, Locale, Role } from '@prisma/client';

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ enum: Locale })
  locale!: Locale;

  @ApiProperty({ enum: Currency })
  currency!: Currency;

  @ApiProperty({ enum: Role })
  role!: Role;
}

export class AuthTokensDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty()
  accessTokenExpiresInSeconds!: number;

  @ApiProperty()
  refreshTokenExpiresInSeconds!: number;
}

export class AuthSessionDto extends AuthTokensDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class SendOtpResponseDto {
  @ApiProperty({ description: 'Seconds until the code expires' })
  expiresInSeconds!: number;

  @ApiProperty({ description: 'Seconds before another OTP can be requested for this phone' })
  resendAfterSeconds!: number;

  /**
   * Dev-only convenience: the raw 6-digit code.
   *
   * Returned in NODE_ENV !== 'production' so developers don't have to dig
   * through pino logs during local testing. In production it's stripped
   * and the code is only deliverable via SMS (once the SMS provider is
   * wired up). The guard lives in AuthService.sendOtp.
   */
  @ApiProperty({
    required: false,
    description: 'Dev-only echo of the OTP code. Present only when NODE_ENV !== "production".',
  })
  devCode?: string;
}
