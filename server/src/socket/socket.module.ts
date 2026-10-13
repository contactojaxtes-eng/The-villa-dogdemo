import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { DeliveryDriverGateway } from './delivery-driver.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [SocketGateway, DeliveryDriverGateway],
  exports: [SocketGateway, DeliveryDriverGateway],
})
export class SocketModule {}
