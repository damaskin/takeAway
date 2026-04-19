import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  let service: OtpService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let redis: jest.Mocked<Partial<RedisService>>;

  beforeEach(async () => {
    prisma = {
      otpRequest: {
        create: jest.fn().mockResolvedValue({ id: 'req-1' }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as jest.Mocked<Partial<PrismaService>>;

    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      incrWithTtl: jest.fn().mockResolvedValue(1),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined) },
        },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  it('issues a 6-digit code and stores the hash', async () => {
    const { code, result } = await service.issue('+14155551234');

    expect(code).toMatch(/^\d{6}$/);
    expect(result.expiresInSeconds).toBe(300);
    expect(prisma.otpRequest!.create).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('otp:cooldown:+14155551234', '1', 60);
  });

  it('rejects verification without an active request', async () => {
    (prisma.otpRequest!.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.verify('+14155551234', '111111')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a matching code and consumes the request', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    (prisma.otpRequest!.findFirst as jest.Mock).mockResolvedValue({
      id: 'req-1',
      codeHash,
      attempts: 0,
    });

    await expect(service.verify('+14155551234', '123456')).resolves.toBeUndefined();
    expect(prisma.otpRequest!.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consumedAt: expect.any(Date) }) }),
    );
  });

  it('rejects a wrong code and increments attempts', async () => {
    const codeHash = await bcrypt.hash('111111', 10);
    (prisma.otpRequest!.findFirst as jest.Mock).mockResolvedValue({
      id: 'req-1',
      codeHash,
      attempts: 0,
    });

    await expect(service.verify('+14155551234', '222222')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.otpRequest!.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } }),
    );
  });
});
