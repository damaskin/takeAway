import { ApiProperty } from '@nestjs/swagger';
import { SHIFT_EXTEND_MINUTES, type ShiftExtendMinutes } from '@takeaway/shared-types';
import { IsIn } from 'class-validator';

export class ExtendShiftDto {
  @ApiProperty({
    enum: [...SHIFT_EXTEND_MINUTES],
    description: '«Продлить»: take ASAP orders this many minutes longer past the working hours',
  })
  @IsIn([...SHIFT_EXTEND_MINUTES])
  minutes!: ShiftExtendMinutes;
}
