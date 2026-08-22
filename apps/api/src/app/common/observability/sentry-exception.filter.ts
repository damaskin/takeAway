import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Reports server-side failures to Sentry, then lets Nest render the
 * response exactly as it would have.
 *
 * Nest catches every throw inside its own exception layer, so without this
 * filter Sentry's global handlers never see them and the dashboard stays
 * empty while production burns.
 *
 * Only genuine faults are reported. A 400 for a bad promo code or a 401 for
 * an expired token is the system working; sending those would bury the one
 * real 500 under thousands of routine rejections.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (shouldReport(exception)) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}

function shouldReport(exception: unknown): boolean {
  if (!(exception instanceof HttpException)) return true; // anything unexpected
  return exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR;
}
