import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

/**
 * Settlements with brands: the commission rate history, what the platform
 * owes each brand for its card payments, and the payouts. See
 * docs/settlements.md.
 */
@Module({
  imports: [AuthModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
})
export class SettlementsModule {}
