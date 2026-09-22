import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  type HttpServer,
  HttpStatus,
  Logger,
} from '@nestjs/common';
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
 *
 * `applicationRef` is required on purpose. BaseExceptionFilter otherwise
 * expects the DI container to inject an adapter, and this filter is built by
 * hand in `main.ts`; left empty it renders *every* error — a plain 404
 * included — as a 500 saying "Cannot read properties of undefined (reading
 * 'isHeadersSent')", which hides the real failure from every client. Making
 * the parameter mandatory turns that into a compile error.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  constructor(applicationRef: HttpServer) {
    super(applicationRef);
  }

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
