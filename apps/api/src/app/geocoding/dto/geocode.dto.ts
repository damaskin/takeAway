import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class GeocodeQueryDto {
  @ApiProperty({ example: 'ул. 25 Октября 50', description: 'Street and house number, as typed in the store form.' })
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  address!: string;

  @ApiPropertyOptional({ example: 'Тирасполь' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  city?: string;

  @ApiPropertyOptional({ example: 'MD', description: 'ISO 3166-1 alpha-2; keeps the search inside that country.' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^([A-Za-z]{2})?$/, { message: 'country must be a two-letter ISO code' })
  country?: string;
}

export class ReverseGeocodeQueryDto {
  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class GeocodeResultDto {
  @ApiProperty()
  lat!: number;

  @ApiProperty()
  lng!: number;

  @ApiProperty({ description: 'Short readable name of what was found: street, house, city, country.' })
  displayName!: string;

  @ApiProperty({
    description:
      'True when the street address was not found and this is only the city: open the map there, but do not ' +
      'put the store pin on it.',
  })
  approximate!: boolean;
}

export class GeocodeResponseDto {
  @ApiProperty({ type: GeocodeResultDto, nullable: true, description: 'Null when nothing was found.' })
  result!: GeocodeResultDto | null;
}

export class AddressSuggestionDto {
  @ApiProperty()
  lat!: number;

  @ApiProperty()
  lng!: number;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true, type: String, example: 'Покровская улица, 50' })
  addressLine!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Тирасполь' })
  city!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'MD', description: 'ISO 3166-1 alpha-2' })
  country!: string | null;
}

export class ReverseGeocodeResponseDto {
  @ApiProperty({ type: AddressSuggestionDto, nullable: true, description: 'Null when there is no address there.' })
  result!: AddressSuggestionDto | null;
}
