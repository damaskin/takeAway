import { ApiProperty } from '@nestjs/swagger';
import { BrandModerationStatus } from '@prisma/client';

import { AuthSessionDto } from '../../auth/dto/auth-response.dto';

export class BusinessBrandDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: BrandModerationStatus })
  moderationStatus!: BrandModerationStatus;
}

export class BusinessRegisterResponseDto {
  @ApiProperty({ type: BusinessBrandDto })
  brand!: BusinessBrandDto;

  @ApiProperty({
    type: AuthSessionDto,
    description: 'Auth tokens + user identity. Owner is signed in immediately after registration.',
  })
  session!: AuthSessionDto;
}
