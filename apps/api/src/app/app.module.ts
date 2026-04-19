import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminCatalogModule } from './admin/catalog/admin-catalog.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CatalogModule } from './catalog/catalog.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { FeaturesModule } from './config/config.module';
import { DeliveryModule } from './delivery/delivery.module';
import { HealthModule } from './health/health.module';
import { KdsModule } from './kds/kds.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PromoModule } from './promo/promo.module';
import { RealtimeModule } from './realtime/realtime.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
        level: process.env['LOG_LEVEL'] ?? 'info',
        autoLogging: true,
      },
    }),
    PrismaModule,
    RedisModule,
    FeaturesModule,
    UsersModule,
    AuthModule,
    CatalogModule,
    AdminCatalogModule,
    CartModule,
    PromoModule,
    LoyaltyModule,
    OrdersModule,
    PaymentsModule,
    RealtimeModule,
    KdsModule,
    DeliveryModule,
    NotificationsModule,
    AnalyticsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
