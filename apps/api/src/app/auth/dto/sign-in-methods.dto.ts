import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AuthSessionDto } from './auth-response.dto';

export const SIGN_IN_PROVIDERS = ['TELEGRAM', 'GOOGLE', 'APPLE'] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

/** Which doors lead into the signed-in customer's profile. */
export class SignInMethodsDto {
  @ApiProperty()
  telegram!: boolean;

  @ApiProperty()
  google!: boolean;

  @ApiProperty()
  apple!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The proven address a sign-in code by email leads into this profile; null when the profile has none (an address only typed into the profile does not count).',
  })
  email!: string | null;
}

/**
 * Result of linking a sign-in method. Usually just the updated list; when
 * the method already led into a profile with order history and the current
 * one was empty, the two were joined on the other profile and `session`
 * carries tokens for it — the client must switch to them.
 */
export class LinkSignInMethodResultDto {
  @ApiProperty({ type: SignInMethodsDto })
  methods!: SignInMethodsDto;

  @ApiPropertyOptional({
    type: AuthSessionDto,
    description: 'Present when the customer was moved into the profile the method already belonged to',
  })
  session?: AuthSessionDto;
}
