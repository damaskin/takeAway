import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AssignRiderDto {
  @ApiProperty({ description: "userId of the RIDER to assign. Must have a UserStore row for the order's store." })
  @IsString()
  @MinLength(1)
  riderId!: string;
}
