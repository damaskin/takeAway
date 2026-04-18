import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { AuthSessionDto, AuthUserDto, SendOtpResponseDto } from './dto/auth-response.dto';
import type { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './services/otp.service';
import { TelegramService } from './services/telegram.service';
import { TokensService } from './services/tokens.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly telegram: TelegramService,
  ) {}

  async sendOtp(phone: string): Promise<SendOtpResponseDto> {
    const { code, result } = await this.otp.issue(phone);
    this.otp.deliver(phone, code);
    return result;
  }

  async verifyOtp(input: VerifyOtpDto): Promise<AuthSessionDto> {
    await this.otp.verify(input.phone, input.code);

    const user = await this.users.findOrCreateByPhone(input.phone);
    const device = input.deviceType
      ? await this.prisma.device.create({
          data: {
            userId: user.id,
            type: input.deviceType,
            pushToken: input.pushToken,
            locale: user.locale,
          },
        })
      : null;

    const tokens = await this.tokens.issue(user.id, device?.id ?? null);
    return { ...tokens, user: this.toAuthUser(user) };
  }

  async verifyTelegram(initData: string): Promise<AuthSessionDto> {
    const { user: tgUser } = this.telegram.verifyInitData(initData);
    const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim() || null;
    const locale = tgUser.language_code?.toLowerCase().startsWith('ru') ? 'RU' : 'EN';

    const user = await this.prisma.user.upsert({
      where: { telegramUserId: BigInt(tgUser.id) },
      update: {
        name: displayName ?? undefined,
      },
      create: {
        telegramUserId: BigInt(tgUser.id),
        name: displayName,
        locale,
      },
    });

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: 'TELEGRAM', locale: user.locale },
    });

    const tokens = await this.tokens.issue(user.id, device.id);
    return { ...tokens, user: this.toAuthUser(user) };
  }

  refresh(refreshToken: string): Promise<Awaited<ReturnType<TokensService['rotate']>>> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revokeRefresh(refreshToken);
  }

  toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      locale: user.locale,
      currency: user.currency,
      role: user.role,
    };
  }
}
