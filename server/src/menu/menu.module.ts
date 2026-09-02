import { Module } from '@nestjs/common';
import { SocketModule } from '../socket/socket.module';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { PublicMenuController } from './public-menu.controller';

@Module({
  imports: [SocketModule],
  controllers: [MenuController, PublicMenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
