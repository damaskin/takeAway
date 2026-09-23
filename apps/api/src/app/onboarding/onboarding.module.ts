import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnboardingNotifier } from './onboarding-notifier.service';

/**
 * Messages around a brand's way from sign-up to the storefront. Imported by
 * sign-up, the owner's brand screen and platform moderation — the three
 * places that move a brand between moderation states.
 */
@Module({
  imports: [MailModule, NotificationsModule],
  providers: [OnboardingNotifier],
  exports: [OnboardingNotifier],
})
export class OnboardingModule {}
