import { ConflictException, HttpStatus } from '@nestjs/common';

/**
 * A 409 whose body carries a stable `code` — and the offending `field`, when
 * there is one — beside the English `message`. Clients switch on the code to
 * show their own translated text; the message stays for logs and API users.
 */
export function codedConflict(code: string, message: string, field?: string): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    code,
    message,
    ...(field ? { field } : {}),
  });
}
