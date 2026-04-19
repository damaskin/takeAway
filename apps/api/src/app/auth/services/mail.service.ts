import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Outbound transactional email. Pluggable — when SMTP is configured we'll
 * swap in a real provider (nodemailer + SMTP or Resend/Postmark). Until
 * then the service logs the payload so dev flows (and early prod) can
 * observe reset links in API logs without blocking on a vendor decision.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@takeaway.local';
    const smtpHost = this.config.get<string>('SMTP_HOST');

    if (!smtpHost) {
      this.logger.warn(
        `SMTP_HOST is not set — logging reset link instead of sending. ` + `to=${email} from=${from} link=${resetUrl}`,
      );
      return;
    }

    // TODO: wire a real transactional provider (nodemailer + SMTP_* env, or
    // Resend/Postmark) once the mail stack is in place. For now any value of
    // SMTP_HOST falls through to the same log line so ops can tell the mail
    // delivery isn't actually happening.
    this.logger.warn(
      `Mail delivery stub — SMTP_HOST=${smtpHost} present but no provider is wired yet. ` +
        `to=${email} from=${from} link=${resetUrl}`,
    );
  }
}
