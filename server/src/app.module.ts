import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { ZonesModule } from './zones/zones.module';
import { PaymentsModule } from './payments/payments.module';
import { RankingModule } from './ranking/ranking.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SocketModule } from './socket/socket.module';
import { CashRegistersModule } from './cash-registers/cash-registers.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import { PrintModule } from './print/print.module';
import { CacheModule } from './cache/cache.module';
import { MailModule } from './mail/mail.module';
import { CustomersModule } from './customers/customers.module';
import { DeliveryDriversModule } from './delivery-drivers/delivery-drivers.module';
import { AuditModule } from './audit/audit.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { SuperadminModule } from './superadmin/superadmin.module';
import { RolesModule } from './roles/roles.module';
import { TablesModule } from './tables/tables.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'client', 'dist'),
      exclude: ['/api/{*path}', '/docs/{*path}', '/socket.io/{*path}', '/imprimir/{*path}', '/cola-impresion/{*path}'],
    }),
    PrismaModule,
    CacheModule,
    MailModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    MenuModule,
    OrdersModule,
    ZonesModule,
    PaymentsModule,
    RankingModule,
    NotificationsModule,
    SocketModule,
    CashRegistersModule,
    WhatsappModule,
    GeocodingModule,
    PrintModule,
    CustomersModule,
    DeliveryDriversModule,
    TablesModule,
    SuperadminModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
 
