import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

interface IssueResult {
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  private readonly codeLength = 6;
  private readonly ttlSeconds = 5 * 60;
  private readonly resendCooldownSeconds = 60;
  private readonly maxVerifyAttempts = 5;
  private readonly maxSendPerHour = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async issue(phone: string): Promise<{ code: string; result: IssueResult }> {
    const cooldownKey = `otp:cooldown:${phone}`;
    if (await this.redis.get(cooldownKey)) {
      throw new TooManyRequestsException('Please wait before requesting a new code');
    }

    const rateKey = `otp:rate:${phone}`;
    const sends = await this.redis.incrWithTtl(rateKey, 60 * 60);
    if (sends > this.maxSendPerHour) {
      throw new TooManyRequestsException('Too many OTP requests for this phone');
    }

    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await this.prisma.otpRequest.create({ data: { phone, codeHash, expiresAt } });
    await this.redis.set(cooldownKey, '1', this.resendCooldownSeconds);

    return {
      code,
      result: {
        expiresInSeconds: this.ttlSeconds,
        resendAfterSeconds: this.resendCooldownSeconds,
      },
    };
  }

  async verify(phone: string, code: string): Promise<void> {
    const request = await this.prisma.otpRequest.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!request) {
      throw new BadRequestException('No active OTP for this phone');
    }

    if (request.attempts >= this.maxVerifyAttempts) {
      throw new TooManyRequestsException('Too many failed attempts; request a new code');
    }

    const matches = await bcrypt.compare(code, request.codeHash);
    if (!matches) {
      await this.prisma.otpRequest.update({
        where: { id: request.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid code');
    }

    await this.prisma.otpRequest.update({
      where: { id: request.id },
      data: { consumedAt: new Date() },
    });
  }

  deliver(phone: string, code: string): void {
    const env = this.config.get<string>('NODE_ENV');
    if (env === 'production') {
      this.logger.warn(`SMS OTP delivery is not wired to a provider yet (phone=${phone})`);
      return;
    }
    this.logger.log(`Dev OTP for ${phone}: ${code}`);
  }

  private generateCode(): string {
    const max = 10 ** this.codeLength;
    const value = Math.floor(Math.random() * max);
    return value.toString().padStart(this.codeLength, '0');
  }
}
