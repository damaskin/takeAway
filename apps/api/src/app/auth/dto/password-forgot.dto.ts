import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class PasswordForgotDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;
}
