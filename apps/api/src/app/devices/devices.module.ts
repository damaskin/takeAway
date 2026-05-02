import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [PrismaModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
