import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { MailModule } from '../../mail/mail.module';
import { AdminKitchenDevicesController } from './admin-kitchen-devices.controller';
import { AdminStaffMembersController } from './admin-staff-members.controller';
import { AdminStaffMembersService } from './admin-staff-members.service';
import { AdminStaffController } from './admin-staff.controller';
import { AdminStaffService } from './admin-staff.service';
import { StaffInviteMailer } from './staff-invite-mailer.service';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [AdminStaffController, AdminStaffMembersController, AdminKitchenDevicesController],
  providers: [AdminStaffService, AdminStaffMembersService, StaffInviteMailer],
})
export class AdminStaffModule {}
