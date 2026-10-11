import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetStoreBusyDto {
  @ApiProperty({
    description: '«Загружены»: true marks the store busy (status OVERLOADED), false back to normal (OPEN)',
  })
  @IsBoolean()
  busy!: boolean;
}
