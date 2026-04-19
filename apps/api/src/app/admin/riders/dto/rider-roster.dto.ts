import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class AddRiderDto {
  @ApiProperty({ example: '+14155551234', description: 'E.164 phone of the rider user' })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be in E.164 format' })
  phone!: string;

  @ApiPropertyOptional({ description: 'Display name to set on a newly-created rider user' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}
