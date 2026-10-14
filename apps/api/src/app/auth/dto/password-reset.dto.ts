import { ApiProperty } from '@nestjs/swagger';
import { STAFF_PASSWORD_MAX_LENGTH, STAFF_PASSWORD_MIN_LENGTH } from '@takeaway/shared-types';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordResetDto {
  @ApiProperty({ description: 'Raw reset token from the email link' })
  @IsString()
  @MinLength(16)
  token!: string;

  /** The staff password rule (`STAFF_PASSWORD_*`), the one the admin shows next to the field. */
  @ApiProperty({ minLength: STAFF_PASSWORD_MIN_LENGTH, maxLength: STAFF_PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(STAFF_PASSWORD_MIN_LENGTH)
  @MaxLength(STAFF_PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
