import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { OtpService } from './services/otp.service';
import { TelegramService } from './services/telegram.service';
import { TokensService } from './services/tokens.service';
import { UserStoreScopeService } from './services/user-store-scope.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') ?? 'change-me-in-prod-access',
      }),
    }),
    // Global throttler: per-IP coarse defense across the whole API. Dev gets a
    // much more generous default so iterating on the login flow doesn't keep
    // hitting 429 — production keeps the conservative 100/min.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') !== 'production';
        const ttl = Number(config.get('THROTTLER_TTL_MS')) || 60_000;
        const limit = Number(config.get('THROTTLER_LIMIT')) || (isDev ? 1000 : 100);
        return [{ ttl, limit }];
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokensService,
    TelegramService,
    UserStoreScopeService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AuthService, UserStoreScopeService],
})
export class AuthModule {}
