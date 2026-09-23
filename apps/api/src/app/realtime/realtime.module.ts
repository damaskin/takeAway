import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') ?? 'change-me-in-prod-access',
      }),
    }),
  ],
  providers: [RealtimeGateway, UserStoreScopeService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
