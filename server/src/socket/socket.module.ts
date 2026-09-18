import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { DeliveryDriverGateway } from './delivery-driver.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [SocketGateway, DeliveryDriverGateway],
  exports: [SocketGateway, DeliveryDriverGateway],
})
export class SocketModule {}
