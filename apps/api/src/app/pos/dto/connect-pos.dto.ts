import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PosProvider } from '@prisma/client';
import { IsEnum, IsNotEmptyObject, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Body for `POST /admin/pos/connect`. The shape of `credentials` and
 * `settings` is provider-specific and validated against the discriminated
 * union in {@link PosProvider} inside the service layer — class-validator
 * doesn't model unions cleanly.
 */
export class ConnectPosDto {
  @ApiProperty({ enum: PosProvider })
  @IsEnum(PosProvider)
  provider!: PosProvider;

  /**
   * IIKO   — { apiLogin: string }
   * POSTER — { token: string, accountName: string }
   */
  @ApiProperty({
    description:
      'Provider-specific secret credentials. IIKO: { apiLogin }. POSTER: { token, accountName }. Stored encrypted at rest.',
    type: Object,
  })
  @IsObject()
  @IsNotEmptyObject()
  credentials!: Record<string, string>;

  /**
   * IIKO   — { organizationId?, apiHost? }
   * POSTER — { apiHost? }
   */
  @ApiPropertyOptional({ description: 'Non-secret per-integration config.', type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, string>;
}

export class PosBrandIdParam {
  @ApiProperty({
    description: 'Brand id — required for SUPER_ADMIN. Ignored for BRAND_ADMIN whose scope is implicit.',
  })
  @IsOptional()
  @IsString()
  brandId?: string;
}
