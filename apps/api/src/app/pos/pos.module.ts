import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PosCronService } from './pos-cron.service';
import { POS_SYNC_QUEUE } from './pos-sync.queue';
import { PosSyncProcessor } from './pos-sync.processor';
import { PosWebhooksController } from './pos-webhooks.controller';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';

/**
 * Wires the POS integration surface — providers, queue, worker, controller.
 *
 * `imports: [AuthModule]` is required by every module that injects
 * BrandScopeService — see the prod incident #107 lesson recorded in
 * memory/session_2026_04_20.md. Skipping it crashes the container at
 * startup with a DI graph error that unit tests don't catch.
 *
 * BullMQ root config lives here for now since POS is the only consumer.
 * If a second module starts using BullMQ, lift `BullModule.forRootAsync`
 * into a shared `QueueModule` to avoid double-registration.
 */
@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
        return {
          connection: {
            host: url.hostname,
            port: url.port ? Number(url.port) : 6379,
            username: url.username || undefined,
            password: url.password || undefined,
            db: url.pathname && url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: POS_SYNC_QUEUE }),
  ],
  controllers: [PosController, PosWebhooksController],
  providers: [PosService, IikoProvider, PosterProvider, PosSyncProcessor, PosCronService],
  exports: [PosService],
})
export class PosModule {}
