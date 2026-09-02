import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SocketModule } from '../socket/socket.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [SocketModule, WhatsappModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
