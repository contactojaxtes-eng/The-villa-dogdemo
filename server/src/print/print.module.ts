import { Module, forwardRef } from '@nestjs/common';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';
import { SocketModule } from '../socket/socket.module';
import { OrdersModule } from '../orders/orders.module';
import { PrintQueueSignalService } from './print-queue-signal.service';

@Module({
  imports: [SocketModule, forwardRef(() => OrdersModule)],
  controllers: [PrintController],
  providers: [PrintService, PrintQueueSignalService],
  exports: [PrintService, PrintQueueSignalService],
})
export class PrintModule {}
