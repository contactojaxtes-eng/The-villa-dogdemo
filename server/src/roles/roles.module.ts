import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SocketModule } from '../socket/socket.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, SocketModule, AuthModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
