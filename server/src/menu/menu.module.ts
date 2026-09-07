import { Module } from '@nestjs/common';
import { SocketModule } from '../socket/socket.module';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuGateway } from './public-menu.gateway';

@Module({
  imports: [SocketModule],
  controllers: [MenuController, PublicMenuController],
  providers: [MenuService, PublicMenuGateway],
  exports: [MenuService],
})
export class MenuModule {}
