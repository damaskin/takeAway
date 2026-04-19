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
