import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class PasswordChangeSelfDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
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
