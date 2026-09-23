import { BadRequestException } from '@nestjs/common';
import type { CheckoutErrorBody, CheckoutErrorCode } from '@takeaway/shared-types';

type CheckoutErrorDetails = Omit<CheckoutErrorBody, 'statusCode' | 'error' | 'code' | 'message'>;

/**
 * A 400 on the order path whose body carries a stable `code`, plus whatever
 * the client needs to word it (the items that ran out, the minimum order).
 * Web and the Mini App translate the code; the English `message` stays for
 * logs and API users.
 */
export function checkoutError(
  code: CheckoutErrorCode,
  message: string,
  details: CheckoutErrorDetails = {},
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code,
    message,
    ...details,
  } satisfies CheckoutErrorBody);
}
