import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class PasswordResetDto {
  @ApiProperty({ description: 'Raw reset token from the email link' })
  @IsString()
  @MinLength(16)
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
