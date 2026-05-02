import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, User } from '@prisma/client';

import { LoyaltyService } from '../loyalty/loyalty.service';
import { PrismaService } from '../prisma/prisma.service';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

interface ReferralSummary {
  code: string;
  /** How many friends have applied this user's code so far. */
  signupsCount: number;
  /** How many of those have triggered the bonus (first PAID order). */
  rewardedCount: number;
  /** Total points earned by being a referrer. */
  pointsEarned: number;
  /** True when the user has applied someone else's code (their own first-order bonus is locked in). */
  appliedCode: string | null;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  private readonly bonusPoints: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    config: ConfigService,
  ) {
    this.bonusPoints = Number(config.get('REFERRAL_BONUS_POINTS')) || 100;
  }

  /**
   * Lazily ensures the user has a `referralCode` and returns a summary
   * suitable for the profile page. Code is generated on first read so we
   * don't have to retro-fill existing rows.
   */
  async getMine(userId: string): Promise<ReferralSummary> {
    const user = await this.ensureCode(userId);

    const [signupsCount, rewardedAggregate, applied] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: userId } }),
      this.prisma.referral.aggregate({
        where: { referrerId: userId, status: 'REWARDED' },
        _sum: { referrerPointsCredited: true },
        _count: { _all: true },
      }),
      this.prisma.referral.findUnique({
        where: { refereeId: userId },
        include: { referrer: { select: { referralCode: true } } },
      }),
    ]);

    return {
      code: user.referralCode!,
      signupsCount,
      rewardedCount: rewardedAggregate._count._all,
      pointsEarned: rewardedAggregate._sum.referrerPointsCredited ?? 0,
      appliedCode: applied?.referrer.referralCode ?? null,
    };
  }

  /**
   * Apply someone else's code to the caller. Locked once — can't be
   * applied a second time, can't be applied to the user's own code, and
   * can't be applied after the user has any PAID order on file.
   */
  async applyCode(userId: string, rawCode: string): Promise<ReferralSummary> {
    const code = normalizeCode(rawCode);
    if (!code) throw new BadRequestException('Empty referral code');

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, referralCode: true, referredByUserId: true },
    });
    if (!me) throw new NotFoundException('User not found');
    if (me.referralCode === code) {
      throw new BadRequestException('You cannot apply your own referral code');
    }
    if (me.referredByUserId) {
      throw new BadRequestException('You have already applied a referral code');
    }
    // Anti-abuse: applying after the first paid order would let users redeem
    // their own bonus by signing up a fake friend later. The first paid
    // order is what triggers the reward — once the user has one, the code
    // is no longer applicable.
    const paidExisting = await this.prisma.order.count({
      where: {
        userId,
        status: { in: ['PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
      },
    });
    if (paidExisting > 0) {
      throw new BadRequestException('Referral codes can only be applied before your first paid order');
    }

    const referrer = await this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!referrer) throw new BadRequestException('Referral code is not valid');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { referredByUserId: referrer.id } });
      await tx.referral.create({
        data: { referrerId: referrer.id, refereeId: userId, status: 'PENDING' },
      });
    });

    return this.getMine(userId);
  }

  /**
   * Called from OrdersService on the PAID transition. If the paying user
   * has a PENDING referral row, we credit BOTH sides (referee + referrer)
   * with `REFERRAL_BONUS_POINTS` (default 100), then flip the row to
   * REWARDED so the bonus only fires once. No-op for non-referred users
   * or for orders that are not the user's first paid one.
   */
  async grantBonusOnFirstPaidOrder(input: {
    userId: string;
    orderId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { userId, orderId } = input;
    const referral = await this.prisma.referral.findUnique({ where: { refereeId: userId } });
    if (!referral || referral.status !== 'PENDING') return;

    const exec = async (tx: Prisma.TransactionClient) => {
      await tx.referral.update({
        where: { id: referral.id },
        data: {
          status: 'REWARDED',
          rewardOrderId: orderId,
          rewardedAt: new Date(),
          refereePointsCredited: this.bonusPoints,
          referrerPointsCredited: this.bonusPoints,
        },
      });

      // Credit both sides through LoyaltyService — keeps tier
      // progression, ledger and balance in lockstep.
      await this.loyalty.creditBonus(
        referral.refereeId,
        this.bonusPoints,
        'Referral bonus · signed up via a friend',
        tx,
        orderId,
      );
      await this.loyalty.creditBonus(
        referral.referrerId,
        this.bonusPoints,
        'Referral bonus · friend placed first order',
        tx,
        orderId,
      );
    };

    if (input.tx) {
      await exec(input.tx);
    } else {
      await this.prisma.$transaction(exec);
    }
  }

  private async ensureCode(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.referralCode) return user;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        return await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      } catch (err) {
        const isUnique =
          typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
        if (!isUnique) throw err;
      }
    }
    throw new ForbiddenException('Could not allocate a referral code; please retry');
  }
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}
