import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SocketModule } from '../socket/socket.module';
import { DeliveryDriversService } from './delivery-drivers.service';
import { DeliveryDriversController } from './delivery-drivers.controller';

@Module({
  imports: [PrismaModule, SocketModule],
  controllers: [DeliveryDriversController],
  providers: [DeliveryDriversService],
  exports: [DeliveryDriversService],
})
export class DeliveryDriversModule {}
