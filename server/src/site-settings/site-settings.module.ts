import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SocketModule } from '../socket/socket.module';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';

@Module({
  imports: [AuthModule, SocketModule],
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
