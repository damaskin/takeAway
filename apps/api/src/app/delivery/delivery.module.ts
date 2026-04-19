import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DeliveryFeeService } from './delivery-fee.service';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [AuthModule, RealtimeModule, NotificationsModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryFeeService],
  exports: [DeliveryFeeService],
})
export class DeliveryModule {}
