import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import { RealtimeGateway } from './realtime.gateway';
import { StoreAvailabilityNotifier } from './store-availability.notifier';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') ?? 'change-me-in-prod-access',
      }),
    }),
  ],
  providers: [RealtimeGateway, UserStoreScopeService, StoreAvailabilityNotifier],
  exports: [RealtimeGateway, StoreAvailabilityNotifier],
})
export class RealtimeModule {}
