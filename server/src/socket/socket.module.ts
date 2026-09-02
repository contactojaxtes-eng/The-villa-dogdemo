import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
