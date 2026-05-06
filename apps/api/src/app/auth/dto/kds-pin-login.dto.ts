import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class KdsPinLoginDto {
  @ApiProperty({ description: 'Store id the kitchen tablet is paired to.' })
  @IsString()
  @Length(1, 64)
  storeId!: string;

  @ApiProperty({ description: '4–6 digit numeric PIN.' })
  @IsString()
  @Matches(/^[0-9]{4,6}$/)
  pin!: string;
}
