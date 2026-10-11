import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StaffInviteEmailStatus, StaffRoleName } from '@takeaway/shared-types';

import { PasswordService } from '../../auth/services/password.service';
import { adminAppUrl } from '../../common/config/admin-app-url';
import { MailService } from '../../mail/mail.service';
import { staffInviteMail, staffPasswordResetMail } from '../../mail/staff-invite.mail';
import { PrismaService } from '../../prisma/prisma.service';

/** How long the "set your password" link in an invite, or after an owner's reset, works. */
export const STAFF_INVITE_LINK_TTL_HOURS = 72;

/** Someone whose password the owner reset on the Staff page. */
export interface StaffPasswordResetRecipient {
  userId: string;
  email: string;
  name: string | null;
  /** The stores the person works at, of the owner's brands — the mail names the brand. */
  storeIds: string[];
}

export interface StaffInviteRecipient {
  userId: string;
  email: string;
  name: string | null;
  role: StaffRoleName;
  /** The stores the person was just added to — the mail names their brand. */
  storeIds: string[];
  /** The account was created by this invite (and has only the owner's temporary password). */
  newAccount: boolean;
}

/**
 * Emails a person invited on the Staff page. Nobody was told before: the
 * owner had to pass the address, the temporary password and the cabinet's
 * URL on by hand.
 *
 * A new account gets a one-time link (a password-reset token, valid
 * {@link STAFF_INVITE_LINK_TTL_HOURS} hours) to set its own password; the
 * temporary password the owner typed still works too and is never mailed.
 * An existing account only learns where to sign in. Without SMTP (or, in
 * production, ADMIN_APP_URL for the links) nothing is sent and no token is
 * made — the answer says so, and the admin tells the owner to pass the
 * password on themselves.
 *
 * The same goes for someone whose password the owner reset: a one-time link
 * to set a new one ({@link sendPasswordReset}).
 */
@Injectable()
export class StaffInviteMailer {
  private readonly logger = new Logger(StaffInviteMailer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async send(recipient: StaffInviteRecipient): Promise<StaffInviteEmailStatus> {
    const base = this.mailBase('Invite', recipient.userId);
    if (!base) return 'NOT_CONFIGURED';

    const brandName = await this.brandName(recipient.storeIds);
    const setPasswordUrl = recipient.newAccount
      ? `${await this.setPasswordUrl(recipient.userId, base)}&invite=1`
      : null;

    const sent = await this.mail.sendStaffInvite(
      recipient.email,
      staffInviteMail({
        to: recipient.email,
        name: recipient.name,
        brandName,
        role: recipient.role,
        loginUrl: `${base}/login`,
        setPasswordUrl,
        linkTtlHours: STAFF_INVITE_LINK_TTL_HOURS,
        forgotUrl: `${base}/forgot-password`,
      }),
    );
    return sent ? 'SENT' : 'FAILED';
  }

  /**
   * After the owner reset someone's password: a one-time link to set a new
   * one (valid {@link STAFF_INVITE_LINK_TTL_HOURS} hours, like an invite's).
   * The temporary password the owner was shown is never mailed. Same
   * answers as {@link send}.
   */
  async sendPasswordReset(recipient: StaffPasswordResetRecipient): Promise<StaffInviteEmailStatus> {
    const base = this.mailBase('Password reset', recipient.userId);
    if (!base) return 'NOT_CONFIGURED';

    const sent = await this.mail.sendStaffPasswordReset(
      recipient.email,
      staffPasswordResetMail({
        to: recipient.email,
        name: recipient.name,
        brandName: await this.brandName(recipient.storeIds),
        loginUrl: `${base}/login`,
        setPasswordUrl: await this.setPasswordUrl(recipient.userId, base),
        linkTtlHours: STAFF_INVITE_LINK_TTL_HOURS,
      }),
    );
    return sent ? 'SENT' : 'FAILED';
  }

  /** The admin's base URL when an email with links can go out; null (and a warning) when it cannot. */
  private mailBase(what: string, userId: string): string | null {
    const base = adminAppUrl(this.config);
    if (this.mail.isConfigured() && base) return base;
    const missing = [this.mail.isConfigured() ? null : 'SMTP_HOST', base ? null : 'ADMIN_APP_URL'].filter(Boolean);
    this.logger.warn(`${what} email for user ${userId} not sent: ${missing.join(', ')} not set`);
    return null;
  }

  private async brandName(storeIds: string[]): Promise<string> {
    const stores = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { brand: { select: { name: true } } },
    });
    return [...new Set(stores.map((s) => s.brand.name))].join(', ') || 'takeAway';
  }

  /** A fresh one-time token, stored hashed, as the admin's set-password link. */
  private async setPasswordUrl(userId: string, base: string): Promise<string> {
    const { raw, hash } = this.passwords.issueResetToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + STAFF_INVITE_LINK_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    return `${base}/reset-password?token=${raw}`;
  }
}
