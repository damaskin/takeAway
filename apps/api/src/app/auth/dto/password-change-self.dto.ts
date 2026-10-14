import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STAFF_PASSWORD_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH } from '@takeaway/shared-types';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordChangeSelfDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  /** The staff password rule (`STAFF_PASSWORD_*`), the one the admin shows next to the field. */
  @ApiProperty({
    minLength: STAFF_PASSWORD_MIN_LENGTH,
    maxLength: STAFF_PASSWORD_MAX_LENGTH,
    description: 'Has to differ from the current password (400 PASSWORD_UNCHANGED).',
  })
  @IsString()
  @MinLength(STAFF_PASSWORD_MIN_LENGTH)
  @MaxLength(STAFF_PASSWORD_MAX_LENGTH)
  newPassword!: string;

  @ApiPropertyOptional({
    description:
      'The refresh token of the session making the change. A password change signs out every other ' +
      'session of the account; this one stays signed in. Without it, this session ends too once its ' +
      'access token expires.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
