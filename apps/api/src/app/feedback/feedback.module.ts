import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminFeedbackController } from './admin-feedback.controller';
import { FeedbackController } from './feedback.controller';
import { FeedbackNotifier } from './feedback-notifier.service';
import { FeedbackService } from './feedback.service';

/**
 * «Обратная связь»: reviews, suggestions and problem reports customers send
 * from their profile, and the platform admin's inbox for them.
 */
@Module({
  imports: [MailModule, NotificationsModule],
  controllers: [FeedbackController, AdminFeedbackController],
  providers: [FeedbackService, FeedbackNotifier],
})
export class FeedbackModule {}
