import { ApiProperty } from '@nestjs/swagger';
import { Currency, Locale, Role } from '@prisma/client';
import type { KitchenSessionStore } from '@takeaway/shared-types';

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Staff sign-in name of an account without an email' })
  login!: string | null;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ enum: Locale })
  locale!: Locale;

  @ApiProperty({ enum: Currency })
  currency!: Currency;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Telegram chat id if linked (BigInt serialized as string)',
  })
  telegramUserId!: string | null;
}

export class KitchenSessionStoreDto implements KitchenSessionStore {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  city!: string;
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

  @ApiProperty({
    required: false,
    description: 'True when the user was invited with a temp password and must rotate it before continuing.',
  })
  mustChangePassword?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Kitchen PIN session: the store the board opens on — the one the tablet asked for, or the person’s only (first) store.',
  })
  kdsStoreId?: string;

  @ApiProperty({
    required: false,
    description:
      'Set on a kitchen PIN session: the brand of the tablet. Such a session only opens the kitchen board and stop-list of the person’s stores in this brand.',
  })
  kdsBrandId?: string;

  @ApiProperty({
    required: false,
    type: [KitchenSessionStoreDto],
    description:
      'Kitchen PIN session: the person’s stores in the tablet’s brand. More than one — the tablet asks which to open.',
  })
  kdsStores?: KitchenSessionStoreDto[];
}
