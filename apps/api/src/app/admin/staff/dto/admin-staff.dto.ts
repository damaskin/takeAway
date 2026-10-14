import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  STAFF_LOGIN_MAX_LENGTH,
  STAFF_LOGIN_MIN_LENGTH,
  STAFF_LOGIN_PATTERN,
  STAFF_PASSWORD_MAX_LENGTH,
  STAFF_PASSWORD_MIN_LENGTH,
} from '@takeaway/shared-types';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const ALLOWED_ROLES = [Role.STORE_MANAGER, Role.STAFF, Role.MENU_EDITOR] as const;
export type StaffRole = (typeof ALLOWED_ROLES)[number];

/** Exactly one of `email` and `login`: the person is invited by one or the other. */
@ValidatorConstraint({ name: 'emailOrLogin' })
class EmailOrLogin implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as AddStaffDto;
    return (dto.email === undefined) !== (dto.login === undefined);
  }

  defaultMessage(): string {
    return 'send either email or login';
  }
}

const lowercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class AddStaffDto {
  @ApiPropertyOptional({ example: 'manager@brand.com', description: 'Email, or leave out and send `login`.' })
  @ValidateIf((o: AddStaffDto) => o.email !== undefined || o.login === undefined)
  @IsEmail()
  email?: string;

  /**
   * For someone without an email. A new account is created with it — a
   * login already taken by anyone is 409 LOGIN_IN_USE, never a link to that
   * account — and no invite is mailed: the owner hands the login and the
   * temporary password over.
   */
  @ApiPropertyOptional({
    example: 'anna.k',
    minLength: STAFF_LOGIN_MIN_LENGTH,
    maxLength: STAFF_LOGIN_MAX_LENGTH,
    pattern: STAFF_LOGIN_PATTERN.source,
    description:
      'Login for someone without an email (case-insensitive, stored lowercase). Exactly one of email and login.',
  })
  @ValidateIf((o: AddStaffDto) => o.login !== undefined || o.email === undefined)
  @Transform(lowercase)
  @IsString()
  @Matches(STAFF_LOGIN_PATTERN, {
    message: `login must be ${STAFF_LOGIN_MIN_LENGTH}-${STAFF_LOGIN_MAX_LENGTH} latin letters, digits, dots, underscores or hyphens`,
  })
  @Validate(EmailOrLogin)
  login?: string;

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

  @ApiProperty({
    minLength: STAFF_PASSWORD_MIN_LENGTH,
    maxLength: STAFF_PASSWORD_MAX_LENGTH,
    description:
      'Temporary password the owner hands over; the person must change it on first sign-in. A new account invited by email is also emailed a one-time link to set its own.',
  })
  @IsString()
  @MinLength(STAFF_PASSWORD_MIN_LENGTH)
  @MaxLength(STAFF_PASSWORD_MAX_LENGTH)
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
