import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { SocketModule } from '../socket/socket.module';
import { WhatsAppSiteResolverService } from './whatsapp-site-resolver.service';

@Module({
  imports: [SocketModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsAppSiteResolverService],
  exports: [WhatsappService, WhatsAppSiteResolverService],
})
export class WhatsappModule {}
