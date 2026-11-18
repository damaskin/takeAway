import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { OptionGroupKind, OptionGroupScope, OptionGroupType } from '@prisma/client';
import {
  type ApplyGroupPriceRequest,
  type BrandOptionCatalog,
  type BrandOptionSetting,
  type BrandProductOptionPrice,
  type CatalogGroup,
  type CatalogOption,
  OPTION_NAME_MAX_LENGTH,
  OPTION_NOTE_MAX_LENGTH,
  type ProductOptionGroupLink,
  type ProductOptionGroupsConfig,
  type ProductOptionOverride,
} from '@takeaway/shared-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** A blank note is no note. */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : (value ?? undefined);

// ─── Catalog (SUPER_ADMIN) ──────────────────────────────────────────────────

export class CatalogOptionDto implements CatalogOption {
  @ApiProperty() id!: string;
  @ApiProperty() groupId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Second line under the name («300–350 мл»)' })
  note!: string | null;
  @ApiProperty({ description: 'A and B: picked when the product page opens (a product may override)' })
  isDefault!: boolean;
  @ApiProperty({ type: Number, nullable: true, description: 'C only' }) minQty!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'C only' }) maxQty!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'C only: units included in the price' })
  defaultQty!: number | null;
  @ApiProperty() sortOrder!: number;
}

export class CatalogGroupDto implements CatalogGroup {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: OptionGroupKind }) kind!: OptionGroupKind;
  @ApiProperty({ enum: OptionGroupType }) type!: OptionGroupType;
  @ApiProperty() name!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'A only' }) minSelect!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'A only; null = as many as there are' })
  maxSelect!: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Shown only while this option is picked' })
  showIfOptionId!: string | null;
  @ApiProperty({
    enum: OptionGroupScope,
    description: 'Drinks, food or both: the product editor offers it for products of a matching category kind',
  })
  scope!: OptionGroupScope;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: [CatalogOptionDto] }) options!: CatalogOptionDto[];
  @ApiPropertyOptional({ description: 'How many products (all brands) have it attached; the catalog list only' })
  productCount?: number;
}

export class CreateCatalogGroupDto {
  @ApiProperty({ enum: OptionGroupKind })
  @IsEnum(OptionGroupKind)
  kind!: OptionGroupKind;

  /** D is accepted by the validation and refused by the rules (400 OPTION_GROUP_INVALID), as the contract says. */
  @ApiProperty({ enum: ['A', 'B', 'C'], description: 'D is reserved: 400 OPTION_GROUP_INVALID' })
  @IsEnum(OptionGroupType)
  type!: OptionGroupType;

  @ApiProperty({ maxLength: OPTION_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(OPTION_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'A only (null for B and C)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  minSelect?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'A only, at least 1; null = no limit' })
  @IsOptional()
  @IsInt()
  @Max(1000)
  maxSelect?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Shown only while this option (of another group) is picked',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  showIfOptionId?: string | null;

  @ApiPropertyOptional({
    enum: OptionGroupScope,
    description: 'Drinks, food or both (omitted on create: BOTH). Drinks: hot and cold drinks; food: food, bakery',
  })
  @IsOptional()
  @IsEnum(OptionGroupScope)
  scope?: OptionGroupScope;

  @ApiPropertyOptional({ description: 'Omitted on create: after the last group' })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;
}

export class UpdateCatalogGroupDto extends PartialType(CreateCatalogGroupDto) {}

export class CreateCatalogOptionDto {
  @ApiProperty({ maxLength: OPTION_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(OPTION_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: OPTION_NOTE_MAX_LENGTH })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(OPTION_NOTE_MAX_LENGTH)
  note?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'C only; null reads as 0' })
  @IsOptional()
  @IsInt()
  minQty?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'C only; null reads as 20' })
  @IsOptional()
  @IsInt()
  maxQty?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'C only; null reads as 0' })
  @IsOptional()
  @IsInt()
  defaultQty?: number | null;

  @ApiPropertyOptional({ description: 'Omitted on create: after the last option of the group' })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;
}

export class UpdateCatalogOptionDto extends PartialType(CreateCatalogOptionDto) {}

// ─── Brand ──────────────────────────────────────────────────────────────────

export class BrandOptionSettingDto implements BrandOptionSetting {
  @ApiProperty() optionId!: string;
  @ApiProperty({
    description:
      'ADDON price for the whole brand (C: per unit above defaultQty); a product may set its own. Not read for VARIANT',
  })
  priceCents!: number;
  @ApiProperty({ description: 'False = the brand does not have it: hidden from its customers' })
  enabled!: boolean;
  @ApiProperty({ type: [String], description: 'Stores of the brand where it has run out right now' })
  stoppedStoreIds!: string[];
}

export class BrandProductOptionPriceDto implements BrandProductOptionPrice {
  @ApiProperty() optionId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ description: "VARIANT: added to the product's base price (0 = base). ADDON: the product's own price" })
  priceCents!: number;
}

export class BrandOptionCatalogDto implements BrandOptionCatalog {
  @ApiProperty({ type: [CatalogGroupDto] }) groups!: CatalogGroupDto[];
  @ApiProperty({ type: [BrandOptionSettingDto], description: 'One per catalog option (no row = enabled at 0)' })
  settings!: BrandOptionSettingDto[];
  @ApiProperty({
    type: [BrandProductOptionPriceDto],
    description:
      'Read-only prices set in product cards: every variant option of a group attached to a product of the brand ' +
      'with what it adds there, and every add-on a product prices on its own. By product name',
  })
  productPrices!: BrandProductOptionPriceDto[];
}

export class ApplyGroupPriceDto implements ApplyGroupPriceRequest {
  @ApiProperty({ description: 'Minor units, one price for every option of the group (an add-on group)' })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents!: number;
}

export class UpdateBrandOptionDto {
  @ApiPropertyOptional({ description: 'Minor units; ignored for VARIANT options (priced per product)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class SetOptionStopDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the option comes back by itself (e.g. the end of the day); null or omitted = until switched on',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;
}

export class OptionStopDto {
  @ApiProperty() storeId!: string;
  @ApiProperty() optionId!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt!: string | null;
}

// ─── Product ────────────────────────────────────────────────────────────────

export class ProductOptionGroupLinkDto implements ProductOptionGroupLink {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  groupId!: string;

  @ApiProperty()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder!: number;
}

export class ProductOptionOverrideDto implements ProductOptionOverride {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  optionId!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "VARIANT: added to the base price; null = 0. ADDON: the product's own price instead of the brand's " +
      "(not below 0); null = the brand's",
  })
  @IsOptional()
  @IsInt()
  @Min(-100_000_000)
  @Max(100_000_000)
  priceCents!: number | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: "A and B: the product's own default; null = the catalog's",
  })
  @IsOptional()
  @IsBoolean()
  isDefault!: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: 'False = not offered on this product; null or omitted = offered when the brand has it',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean | null;
}

export class ProductOptionGroupsConfigDto implements ProductOptionGroupsConfig {
  @ApiProperty({ type: [ProductOptionGroupLinkDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionGroupLinkDto)
  groups!: ProductOptionGroupLinkDto[];

  @ApiProperty({ type: [ProductOptionOverrideDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionOverrideDto)
  overrides!: ProductOptionOverrideDto[];
}
