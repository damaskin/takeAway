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

  /**
   * Welcome message after the very first paid order. We send it from
   * OrdersService on the PAID transition, gated by a "first paid order"
   * check so existing customers don't get spammed.
   */
  async sendWelcome(email: string, displayName: string | null): Promise<void> {
    const greeting = displayName ? `Привет, ${displayName}!` : 'Добро пожаловать!';
    const greetingEn = displayName ? `Hi ${displayName},` : 'Hi there,';
    const subject = 'Добро пожаловать в takeAway / Welcome to takeAway';
    const text =
      `${greeting}\n\n` +
      `Спасибо за первый заказ через takeAway! Теперь вам доступны бонусы лояльности, скидочные промокоды и быстрый повтор любимого заказа.\n\n` +
      `${greetingEn}\n\n` +
      `Thanks for your first takeAway order! Loyalty points, promo codes and one-tap reorder are now available in your profile.`;
    const html = `
      <p>${escapeHtml(greeting)}</p>
      <p>Спасибо за первый заказ через <strong>takeAway</strong>! Теперь вам доступны бонусы лояльности, промокоды и быстрый повтор любимого заказа.</p>
      <hr />
      <p>${escapeHtml(greetingEn)}</p>
      <p>Thanks for your first <strong>takeAway</strong> order! Loyalty points, promo codes and one-tap reorder are now available in your profile.</p>
    `;
    await this.send(email, subject, text, html);
  }

  /**
   * Order receipt sent on the PAID transition. Plain HTML — kept simple
   * because we mail it before knowing how the SMTP provider renders rich
   * content. Currency is the order's stored ISO code.
   */
  async sendOrderReceipt(
    email: string,
    receipt: {
      orderCode: string;
      storeName: string;
      currency: string;
      subtotalCents: number;
      discountCents: number;
      deliveryFeeCents: number;
      taxCents: number;
      /** True when the tax is already inside the prices above. */
      taxIncluded: boolean;
      totalCents: number;
      items: Array<{ name: string; quantity: number; totalCents: number }>;
    },
    attachments?: MailAttachment[],
  ): Promise<void> {
    const subject = `Чек по заказу #${receipt.orderCode} / takeAway receipt #${receipt.orderCode}`;
    const fmt = (cents: number) => formatMoney(cents, receipt.currency);
    const itemsText = receipt.items.map((i) => `  ${i.quantity} × ${i.name} — ${fmt(i.totalCents)}`).join('\n');
    const itemsHtml = receipt.items
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:right">×${i.quantity}</td><td style="text-align:right">${escapeHtml(fmt(i.totalCents))}</td></tr>`,
      )
      .join('');

    const text =
      `Спасибо за заказ #${receipt.orderCode} в ${receipt.storeName}.\n\n` +
      `${itemsText}\n\n` +
      `Итого: ${fmt(receipt.totalCents)}\n\n` +
      `--\n\n` +
      `Thanks for your order #${receipt.orderCode} at ${receipt.storeName}.\n\n` +
      `${itemsText}\n\n` +
      `Total: ${fmt(receipt.totalCents)}`;

    const html = `
      <p>Спасибо за заказ <strong>#${escapeHtml(receipt.orderCode)}</strong> в ${escapeHtml(receipt.storeName)}.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0">${itemsHtml}</table>
      ${receipt.discountCents > 0 ? `<p>Скидка: −${escapeHtml(fmt(receipt.discountCents))}</p>` : ''}
      ${receipt.deliveryFeeCents > 0 ? `<p>Доставка: ${escapeHtml(fmt(receipt.deliveryFeeCents))}</p>` : ''}
      ${taxLine(receipt.taxCents, receipt.taxIncluded, fmt)}
      <p><strong>Итого:</strong> ${escapeHtml(fmt(receipt.totalCents))}</p>
      <hr />
      <p>Thanks for your order <strong>#${escapeHtml(receipt.orderCode)}</strong> at ${escapeHtml(receipt.storeName)}.</p>
      <p><strong>Total:</strong> ${escapeHtml(fmt(receipt.totalCents))}</p>
    `;
    await this.send(email, subject, text, html, attachments);
  }

  /** Public helper so other services can queue transactional messages through the same transport. */
  async send(to: string, subject: string, text: string, html?: string, attachments?: MailAttachment[]): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@takeaway.local';
    if (!this.transporter) {
      this.logger.warn(
        `[mail] (stub — SMTP_HOST not set) to=${to} subject=${JSON.stringify(subject)} body=${text.slice(0, 200)}` +
          (attachments?.length ? ` attachments=${attachments.length}` : ''),
      );
      return;
    }
    try {
      await this.transporter.sendMail({ from, to, subject, text, html, attachments });
      this.logger.log(
        `[mail] sent to=${to} subject=${JSON.stringify(subject)}` +
          (attachments?.length ? ` attachments=${attachments.length}` : ''),
      );
    } catch (err) {
      this.logger.error(`[mail] delivery failed to=${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/**
 * The tax line. Worded differently depending on whether the tax sits inside
 * the prices above or was added to them — "including VAT" and "VAT" are
 * different claims, and only one of them is true for a given store.
 */
function taxLine(taxCents: number, included: boolean, fmt: (cents: number) => string): string {
  if (taxCents <= 0) return '';
  const amount = escapeHtml(fmt(taxCents));
  return included ? `<p>В том числе налог / incl. tax: ${amount}</p>` : `<p>Налог / tax: ${amount}</p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
