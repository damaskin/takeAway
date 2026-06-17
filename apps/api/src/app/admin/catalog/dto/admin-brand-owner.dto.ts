import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetBrandOwnerDto {
  @ApiProperty({ example: 'owner@brand.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ minLength: 8, description: 'Required when creating a new user account for the owner' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  tempPassword?: string;
}
