import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminOrderReviewsController } from './admin-order-reviews.controller';
import { OrderReviewsController } from './order-reviews.controller';
import { OrderReviewsService } from './order-reviews.service';

/**
 * «Отзыв на покупку»: the customer rates a handed-over order from its
 * screen, and the platform team reads the reviews in the admin.
 */
@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [OrderReviewsController, AdminOrderReviewsController],
  providers: [OrderReviewsService],
})
export class OrderReviewsModule {}
