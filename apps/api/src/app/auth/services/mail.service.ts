import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Outbound transactional email via SMTP (nodemailer).
 *
 * Configuration (env):
 *   SMTP_HOST     — required to send. Missing → service logs the message.
 *   SMTP_PORT     — default 587.
 *   SMTP_SECURE   — '1'/'true' for TLS-on-connect (port 465). Default false.
 *   SMTP_USER     — auth username (optional for open relays).
 *   SMTP_PASS     — auth password.
 *   SMTP_FROM     — from address (default no-reply@takeaway.local).
 *
 * Delivery failures are caught and logged — they never propagate to the
 * caller so a flaky SMTP provider can't wedge password-reset requests
 * or order receipts.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn('SMTP_HOST is not set — MailService will log outbound messages instead of sending.');
      return;
    }
    const port = Number(this.config.get<string>('SMTP_PORT')) || 587;
    const secure = ['1', 'true', 'yes'].includes((this.config.get<string>('SMTP_SECURE') ?? '').toLowerCase());
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    this.logger.log(`SMTP ready: ${host}:${port} secure=${secure}`);
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    const subject = 'Сброс пароля / Reset your takeAway password';
    const text =
      `Чтобы задать новый пароль, откройте ссылку: ${resetUrl}\n\n` +
      `If you did not request a reset, ignore this email.\n\n` +
      `Open this link to set a new password: ${resetUrl}`;
    const html = `
      <p>Чтобы задать новый пароль, откройте ссылку:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <hr />
      <p>If you did not request a reset, ignore this email. Otherwise, open the link above to set a new password.</p>
    `;
    await this.send(email, subject, text, html);
  }

  /** Public helper so other services can queue transactional messages through the same transport. */
  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@takeaway.local';
    if (!this.transporter) {
      this.logger.warn(
        `[mail] (stub — SMTP_HOST not set) to=${to} subject=${JSON.stringify(subject)} body=${text.slice(0, 200)}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({ from, to, subject, text, html });
      this.logger.log(`[mail] sent to=${to} subject=${JSON.stringify(subject)}`);
    } catch (err) {
      this.logger.error(`[mail] delivery failed to=${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
