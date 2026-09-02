import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { ZonesModule } from './zones/zones.module';
import { PaymentsModule } from './payments/payments.module';
import { ExpensesModule } from './expenses/expenses.module';
import { RankingModule } from './ranking/ranking.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SocketModule } from './socket/socket.module';
import { InventoryModule } from './inventory/inventory.module';
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
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'client', 'dist'),
      exclude: ['/api*', '/docs*', '/socket.io*', '/imprimir*', '/cola-impresion*'],
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
    ExpensesModule,
    RankingModule,
    ReportsModule,
    NotificationsModule,
    SocketModule,
    InventoryModule,
    CashRegistersModule,
    WhatsappModule,
    GeocodingModule,
    PrintModule,
    CustomersModule,
    DeliveryDriversModule,
    SuperadminModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
 