import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminFeedbackController } from './admin-feedback.controller';
import { BusinessSupportController } from './business-support.controller';
import { FeedbackController } from './feedback.controller';
import { FeedbackNotifier } from './feedback-notifier.service';
import { FeedbackService } from './feedback.service';

/**
 * «Обратная связь»: reviews, suggestions and problem reports customers send
 * from their profile, what businesses write to support from the admin, and
 * the platform admin's inbox for all of it. Exports the service for the
 * plan-change request («Перейти на PRO»), which arrives the same way.
 */
@Module({
  imports: [AuthModule, MailModule, NotificationsModule],
  controllers: [FeedbackController, AdminFeedbackController, BusinessSupportController],
  providers: [FeedbackService, FeedbackNotifier],
  exports: [FeedbackService],
})
export class FeedbackModule {}
