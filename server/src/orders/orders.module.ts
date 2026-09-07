import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PublicOrdersController } from './public-orders.controller';
import { SocketModule } from '../socket/socket.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PrintModule } from '../print/print.module';
import { TablesModule } from '../tables/tables.module';

@Module({
  imports: [SocketModule, WhatsappModule, forwardRef(() => PrintModule), forwardRef(() => TablesModule)],
  controllers: [OrdersController, PublicOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
