import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PointsEntryType, Prisma, Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { StorageService } from '../../storage/storage.service';
import { AppleTokenRevocationService } from './apple-token-revocation.service';
import { TokensService } from './tokens.service';

export const STAFF_DELETION_REFUSED =
  'Staff accounts cannot be deleted from the app — they are removed by your business admin or by takeAway support';
export const BRAND_OWNER_DELETION_REFUSED =
  'This account owns a business on takeAway — contact support to close the business before deleting the account';

export interface AccountDeletionOptions {
  /**
   * Fresh Sign in with Apple authorization code from the iOS app, used to
   * revoke the customer's Apple grant (guideline 5.1.1(v)).
   */
  appleAuthorizationCode?: string;
}

/**
 * Self-service account deletion for customers (App Store guideline
 * 5.1.1(v)): `DELETE /auth/me`.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeGateway,
    private readonly apple: AppleTokenRevocationService,
  ) {}

  /**
   * Deletes a customer's account by turning the `User` row into an
   * anonymised tombstone. The row itself stays: orders reference it with
   * `onDelete: Restrict`, and the business records hanging off it must keep
   * pointing at the same id.
   *
   * Who may do it: only `CUSTOMER`. Staff roles are refused (their business
   * admin or support removes them), and so is anyone who owns a brand —
   * deleting the owner would orphan a live business.
   *
   * Sign in with Apple: when the client sends a fresh authorization code,
   * the Apple grant is revoked first — after the checks above pass, before
   * the transaction. Best-effort: Apple being down or unconfigured is logged
   * and never blocks the deletion.
   *
   * Per relation of `User`, all in one transaction:
   *
   *   User row            scrubbed: name, email, phone, avatarUrl,
   *                       dateOfBirth, telegramUserId, passwordHash,
   *                       referralCode, KDS PIN → null; notify flags → false;
   *                       `blockedAt = now`. Clearing telegramUserId and email
   *                       frees both unique slots, so signing in again with
   *                       the same Telegram, Google or Apple account opens a
   *                       new, empty customer instead of this tombstone.
   *   oauthAccounts       deleted — Google/Apple identities are what sign-in
   *                       resolves by; keeping them would lead back here.
   *   devices             deleted — push tokens and per-device locale.
   *   carts (+ items)     deleted — transient, only exist for the person;
   *                       CartItem cascades in the database.
   *   cardTokens          deleted — saved bank cards. Payment.cardTokenId is
   *                       SET NULL, so payments keep their amount, status and
   *                       bank invoice id (all a refund needs).
   *   cardBindings        deleted — pending card-binding attempts (last four
   *                       digits and the phone the OTP went to).
   *   passwordResetTokens deleted.
   *   userStores          deleted — staff store scope; a customer has none,
   *                       cleared for completeness.
   *   loyaltyAccount      kept and zeroed. Deleting it is not an option:
   *                       PointsLedger cascades from LoyaltyAccount, so the
   *                       ledger would go with it. The spendable balance is
   *                       forfeited with a matching EXPIRE ledger row, which
   *                       keeps "every balance change has a ledger row" true.
   *                       Lifetime points and tier are aggregates of the kept
   *                       ledger and stay as they are.
   *   pointsLedger        kept — financial history of the loyalty programme.
   *   orders              kept untouched, including the name and phone
   *                       snapshot taken at checkout: that is the receipt of
   *                       a sale, not a profile field.
   *   assignedDeliveries  kept — rider side; a customer has none.
   *   promoRedemptions    kept — per-promo usage accounting.
   *   giftCardsPurchased  kept — the card belongs to whoever holds the code;
   *                       the purchaser link is sales history.
   *   referrals (both     kept, as is referredByUserId — the reward record of
   *   sides), referees    the programme. The friend's pending bonus still
   *                       fires; a referrer bonus would land on the zeroed,
   *                       blocked account and can never be spent.
   *   shiftsOpened/Closed kept — staff audit trail; a customer has none.
   *   ownedBrands         must be empty, see above.
   *
   * After the commit: every refresh token of the user is deleted from Redis
   * (and `TokensService.rotate` refuses a blocked account anyway, which
   * closes the race with a refresh in flight); access tokens die in the JWT
   * strategy and at the WebSocket handshake on `blockedAt`; open sockets are
   * dropped; an avatar stored in our bucket is removed. These are
   * best-effort — the account is already deleted and blocked when they run,
   * so a failure is logged instead of failing the request.
   */
  async deleteOwnAccount(userId: string, options: AccountDeletionOptions = {}): Promise<void> {
    const appleCode = options.appleAuthorizationCode?.trim();
    if (appleCode) {
      // Apple is only told once the deletion is known to be allowed. The same
      // checks run again inside the transaction, which is what counts.
      await this.assertDeletable(this.prisma, userId);
      await this.bestEffort(userId, 'revoke the Apple grant', () =>
        this.apple.revokeAuthorizationCode(appleCode, userId),
      );
    }

    const deletedAt = new Date();
    const { avatarUrl } = await this.prisma.$transaction(async (tx) => {
      const user = await this.assertDeletable(tx, userId);

      await tx.user.update({
        where: { id: userId },
        data: {
          name: null,
          email: null,
          phone: null,
          avatarUrl: null,
          dateOfBirth: null,
          telegramUserId: null,
          passwordHash: null,
          passwordMustChange: false,
          referralCode: null,
          kdsPinHash: null,
          kdsPinStoreId: null,
          notifyOrderUpdates: false,
          notifyPromotions: false,
          blockedAt: deletedAt,
        },
      });

      await tx.oAuthAccount.deleteMany({ where: { userId } });
      await tx.device.deleteMany({ where: { userId } });
      await tx.cart.deleteMany({ where: { userId } });
      await tx.cardBindingRequest.deleteMany({ where: { userId } });
      await tx.cardToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.userStore.deleteMany({ where: { userId } });

      const loyalty = await tx.loyaltyAccount.findUnique({ where: { userId } });
      if (loyalty && loyalty.pointsBalance !== 0) {
        await tx.loyaltyAccount.update({ where: { id: loyalty.id }, data: { pointsBalance: 0 } });
        await tx.pointsLedger.create({
          data: {
            loyaltyAccountId: loyalty.id,
            userId,
            type: PointsEntryType.EXPIRE,
            amount: -loyalty.pointsBalance,
            reason: 'Forfeited: account deleted',
          },
        });
      }

      return { avatarUrl: user.avatarUrl };
    });

    this.logger.log(`Account deleted by its owner: user=${userId}`);

    await this.bestEffort(userId, 'revoke refresh tokens', () => this.tokens.revokeAll(userId));
    await this.bestEffort(userId, 'disconnect sockets', () => this.realtime.disconnectUser(userId));
    if (avatarUrl) {
      await this.bestEffort(userId, 'delete the avatar file', () => this.storage.deleteByPublicUrl(avatarUrl));
    }
  }

  /** 404 for a missing row, 403 for staff and brand owners; otherwise the bits deletion needs. */
  private async assertDeletable(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
  ): Promise<{ avatarUrl: string | null }> {
    const user = await client.user.findUnique({ where: { id: userId }, select: { role: true, avatarUrl: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== Role.CUSTOMER) throw new ForbiddenException(STAFF_DELETION_REFUSED);
    const ownedBrands = await client.brand.count({ where: { ownerId: userId } });
    if (ownedBrands > 0) throw new ForbiddenException(BRAND_OWNER_DELETION_REFUSED);
    return { avatarUrl: user.avatarUrl };
  }

  private async bestEffort(userId: string, what: string, step: () => unknown): Promise<void> {
    try {
      await step();
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error';
      this.logger.warn(`Account deletion of user=${userId}: could not ${what} (${reason})`);
    }
  }
}
