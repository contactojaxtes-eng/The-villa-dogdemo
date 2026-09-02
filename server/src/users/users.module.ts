import { Module } from '@nestjs/common';
import { SocketModule } from '../socket/socket.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [SocketModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
