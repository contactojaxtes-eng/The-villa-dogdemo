import { Module } from '@nestjs/common';
import { SocketModule } from '../socket/socket.module';
import { ZonesService } from './zones.service';
import { ZonesController } from './zones.controller';
import { PublicZonesController } from './public-zones.controller';

@Module({
  imports: [SocketModule],
  controllers: [ZonesController, PublicZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
