import { Module } from '@nestjs/common';
import { SuperadminController } from './superadmin.controller';
import { SuperadminService } from './superadmin.service';
import { AuthModule } from '../auth/auth.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SocketModule } from '../socket/socket.module';
import { TrafficService } from '../traffic/traffic.service';
import { SiteManagementService } from './site-management.service';

@Module({
  imports: [AuthModule, WhatsappModule, SocketModule],
  controllers: [SuperadminController],
  providers: [SuperadminService, TrafficService, SiteManagementService],
})
export class SuperadminModule {}
