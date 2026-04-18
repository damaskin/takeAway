import { ApiProperty } from '@nestjs/swagger';
import { DeviceType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '+14155551234' })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be in E.164 format' })
  phone!: string;

  @ApiProperty({ example: '123456', description: '6-digit numeric OTP' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;

  @ApiProperty({ enum: DeviceType, required: false })
  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @ApiProperty({ required: false, description: 'FCM / APNs push token to register for this device' })
  @IsOptional()
  @IsString()
  pushToken?: string;
}
