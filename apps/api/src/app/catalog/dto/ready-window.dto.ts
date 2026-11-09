import { ApiProperty } from '@nestjs/swagger';

/**
 * A run of pre-order times under the queue policy (docs/queue-policy.md 2.4):
 * the basket can be ready at every whole minute from `from` to `to`, both
 * included. A window of one minute has `from` equal to `to`.
 */
export class ReadyWindowDto {
  @ApiProperty({ description: 'First minute, ISO-8601 UTC' })
  from!: string;

  @ApiProperty({ description: 'Last minute, ISO-8601 UTC (included)' })
  to!: string;
}
