import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { jwtAccessSecret } from '../auth/jwt-secrets';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import { RealtimeGateway } from './realtime.gateway';
import { StoreAvailabilityNotifier } from './store-availability.notifier';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtAccessSecret(config),
      }),
    }),
  ],
  providers: [RealtimeGateway, UserStoreScopeService, StoreAvailabilityNotifier],
  exports: [RealtimeGateway, StoreAvailabilityNotifier],
})
export class RealtimeModule {}
