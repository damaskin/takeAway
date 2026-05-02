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
   * callers send `pushToken` directly.
   */
  async register(userId: string, dto: RegisterDeviceDto): Promise<{ id: string }> {
    const token = this.resolveToken(dto);

    // Same token already on file — bump lastSeenAt so we can prune stale
    // rows later. Don't create a duplicate.
    const existing = await this.prisma.device.findFirst({
      where: { userId, pushToken: token },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.device.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), locale: dto.locale ?? undefined, type: dto.type },
      });
      return { id: existing.id };
    }

    const created = await this.prisma.device.create({
      data: {
        userId,
        type: dto.type,
        pushToken: token,
        locale: dto.locale ?? 'EN',
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
