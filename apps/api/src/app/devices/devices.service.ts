import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert the caller's device row keyed by the resolved push token. WEB
   * callers send `{ endpoint, keys }`; we serialize the subscription into
   * the same `pushToken` column the WebPushProvider parses back. Native
   * callers send `pushToken` (FCM) directly, iOS also its raw `apnsToken`.
   *
   * A token belongs to one app install, and an install to whoever is
   * signed in on it now: rows another account left behind (its session
   * expired instead of signing out) are removed, or that account's pushes
   * would keep arriving on this phone. So are older rows of the same iOS
   * install whose FCM token has since rotated — they share the APNs token
   * and would get every push twice.
   */
  async register(userId: string, dto: RegisterDeviceDto): Promise<{ id: string }> {
    const token = this.resolveToken(dto);
    const apns =
      dto.type === 'IOS' && dto.apnsToken
        ? { apnsToken: dto.apnsToken.toLowerCase(), apnsEnvironment: dto.apnsEnvironment ?? 'PRODUCTION' }
        : null;

    await this.prisma.device.deleteMany({ where: { pushToken: token, userId: { not: userId } } });
    if (apns) {
      await this.prisma.device.deleteMany({
        where: { apnsToken: apns.apnsToken, NOT: { userId, pushToken: token } },
      });
    }

    // Same token already on file — bump lastSeenAt so we can prune stale
    // rows later. Don't create a duplicate. A missing apnsToken leaves the
    // stored one alone: iOS may not have handed it out yet this launch.
    const existing = await this.prisma.device.findFirst({
      where: { userId, pushToken: token },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.device.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), locale: dto.locale ?? undefined, type: dto.type, ...(apns ?? {}) },
      });
      return { id: existing.id };
    }

    const created = await this.prisma.device.create({
      data: {
        userId,
        type: dto.type,
        pushToken: token,
        locale: dto.locale ?? 'EN',
        ...(apns ?? {}),
      },
      select: { id: true },
    });
    return created;
  }

  /** Drop the caller's device row by token (called on logout / unsubscribe). */
  async unregister(userId: string, dto: RegisterDeviceDto): Promise<void> {
    const token = this.resolveToken(dto);
    await this.prisma.device.deleteMany({ where: { userId, pushToken: token } });
  }

  private resolveToken(dto: RegisterDeviceDto): string {
    if (dto.type === 'WEB') {
      if (!dto.endpoint || !dto.keys?.p256dh || !dto.keys?.auth) {
        throw new BadRequestException('WEB device registration requires endpoint and keys');
      }
      // The WebPushProvider parses this back to a PushSubscription.
      return JSON.stringify({
        endpoint: dto.endpoint,
        keys: { p256dh: dto.keys.p256dh, auth: dto.keys.auth },
      });
    }
    if (!dto.pushToken) {
      throw new BadRequestException('pushToken is required for native devices');
    }
    return dto.pushToken;
  }
}
