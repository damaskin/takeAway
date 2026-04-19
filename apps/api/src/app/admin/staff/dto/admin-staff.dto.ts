import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const ALLOWED_ROLES = [Role.STORE_MANAGER, Role.STAFF] as const;
type StaffRole = (typeof ALLOWED_ROLES)[number];

export class AddStaffDto {
  @ApiProperty({ example: 'manager@brand.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ALLOWED_ROLES })
  @IsEnum(Role)
  role!: StaffRole;

  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiProperty({ minLength: 8, description: 'Temporary password — the user should change it via /forgot-password' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  tempPassword!: string;
}
