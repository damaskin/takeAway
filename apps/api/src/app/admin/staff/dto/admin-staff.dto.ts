import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const ALLOWED_ROLES = [Role.STORE_MANAGER, Role.STAFF, Role.MENU_EDITOR] as const;
export type StaffRole = (typeof ALLOWED_ROLES)[number];

export class AddStaffDto {
  @ApiProperty({ example: 'manager@brand.com' })
  @IsEmail()
  email!: string;

  // Restricted to the staff subset — a request can't escalate someone to
  // BRAND_ADMIN / SUPER_ADMIN through this endpoint.
  @ApiProperty({ enum: ALLOWED_ROLES })
  @IsIn(ALLOWED_ROLES)
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

export class ChangeStaffRoleDto {
  @ApiProperty({ enum: ALLOWED_ROLES })
  @IsIn(ALLOWED_ROLES)
  role!: StaffRole;
}

/** Upper bound on a store list in one request — far above any real brand. */
const MAX_STORES = 200;

export class InviteStaffDto extends AddStaffDto {
  @ApiProperty({ type: [String], description: 'Stores the person will work at; at least one' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STORES)
  @ArrayUnique()
  @IsString({ each: true })
  storeIds!: string[];
}

export class SetStaffStoresDto {
  @ApiProperty({
    type: [String],
    description:
      "Every store of the caller's the person should work at. Stores outside the caller's reach stay as they are; an empty list takes the person off the team.",
  })
  @IsArray()
  @ArrayMaxSize(MAX_STORES)
  @ArrayUnique()
  @IsString({ each: true })
  storeIds!: string[];
}
