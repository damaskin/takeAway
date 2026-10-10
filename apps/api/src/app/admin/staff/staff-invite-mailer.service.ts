import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StaffInviteEmailStatus, StaffRoleName } from '@takeaway/shared-types';

import { PasswordService } from '../../auth/services/password.service';
import { adminAppUrl } from '../../common/config/admin-app-url';
import { MailService } from '../../mail/mail.service';
import { staffInviteMail } from '../../mail/staff-invite.mail';
import { PrismaService } from '../../prisma/prisma.service';

/** How long the "set your password" link in an invite works. */
export const STAFF_INVITE_LINK_TTL_HOURS = 72;

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
    const base = adminAppUrl(this.config);
    if (!this.mail.isConfigured() || !base) {
      const missing = [this.mail.isConfigured() ? null : 'SMTP_HOST', base ? null : 'ADMIN_APP_URL'].filter(Boolean);
      this.logger.warn(`Invite email for user ${recipient.userId} not sent: ${missing.join(', ')} not set`);
      return 'NOT_CONFIGURED';
    }

    const stores = await this.prisma.store.findMany({
      where: { id: { in: recipient.storeIds } },
      select: { brand: { select: { name: true } } },
    });
    const brandName = [...new Set(stores.map((s) => s.brand.name))].join(', ') || 'takeAway';

    let setPasswordUrl: string | null = null;
    if (recipient.newAccount) {
      const { raw, hash } = this.passwords.issueResetToken();
      await this.prisma.passwordResetToken.create({
        data: {
          userId: recipient.userId,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + STAFF_INVITE_LINK_TTL_HOURS * 60 * 60 * 1000),
        },
      });
      setPasswordUrl = `${base}/reset-password?token=${raw}&invite=1`;
    }

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
}
