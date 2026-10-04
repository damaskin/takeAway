import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { AdminStaffMembersController } from './admin-staff-members.controller';
import { AdminStaffMembersService } from './admin-staff-members.service';
import { AdminStaffController } from './admin-staff.controller';
import { AdminStaffService } from './admin-staff.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminStaffController, AdminStaffMembersController],
  providers: [AdminStaffService, AdminStaffMembersService],
})
export class AdminStaffModule {}
