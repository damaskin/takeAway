import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';

@Module({
  imports: [RealtimeModule, AuthModule, NotificationsModule],
  controllers: [KdsController],
  providers: [KdsService],
})
export class KdsModule {}
