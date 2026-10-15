import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { InboxModule } from '../inbox/inbox.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignModerationController } from './campaign-moderation.controller';
import { CampaignModerationService } from './campaign-moderation.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule, MailModule, InboxModule],
  controllers: [CampaignsController, CampaignModerationController],
  providers: [CampaignsService, CampaignModerationService],
})
export class CampaignsModule {}
