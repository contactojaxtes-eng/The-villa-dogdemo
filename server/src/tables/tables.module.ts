import { Module, forwardRef } from '@nestjs/common';
import { TablesController } from './tables.controller';
import { KitchenController } from './kitchen.controller';
import { PaymentValidationController } from './payment-validation.controller';
import { TablesService } from './tables.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SocketModule } from '../socket/socket.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PrismaModule, SocketModule, forwardRef(() => OrdersModule)],
  controllers: [TablesController, KitchenController, PaymentValidationController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
