import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+14155551234', description: 'E.164 formatted phone number' })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be in E.164 format' })
  phone!: string;
}
