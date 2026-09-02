import { Module, forwardRef } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { SocketModule } from '../socket/socket.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { TablesModule } from '../tables/tables.module';

@Module({
  imports: [SocketModule, WhatsappModule, forwardRef(() => TablesModule)],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
