import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    // El portal del domiciliario se agregó sobre instalaciones que ya tienen
    // repartidores registrados. Garantizamos la relación de acceso antes de
    // ejecutar cualquier consulta del módulo, sin borrar ni recrear datos.
    await this.ensureDriverPortalSchema();
    // Production schema changes must run through reviewed migrations.
    if (process.env.NODE_ENV === 'production') {
      await this.ensureDeliveryFoundation();
      return;
    }
    try {
      await this.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;`).catch(() => {});
      await this.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lockoutUntil" TIMESTAMP(3);`).catch(() => {});
      await this.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustVerifyEmail" BOOLEAN NOT NULL DEFAULT false;`).catch(() => {});
      await this.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT true;`).catch(() => {});
      await this.$executeRawUnsafe(`ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "waitingForAdvisor" BOOLEAN NOT NULL DEFAULT false;`).catch(() => {});
      await this.$executeRawUnsafe(`ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;`).catch(() => {});
      await this.$executeRawUnsafe(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "chatSessionId" TEXT;`).catch(() => {});
      await this.$executeRawUnsafe(`UPDATE "whatsapp_sessions" SET "customerPhone" = NULL WHERE "customerPhone" = '3000000000' OR "customerPhone" = '0000000000' OR "customerPhone" LIKE '%3000000000%' OR "customerPhone" LIKE '%0000000000%';`).catch(() => {});
      await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "whatsapp_sessions_waitingForAdvisor_idx" ON "whatsapp_sessions"("waitingForAdvisor");`).catch(() => {});
      await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "whatsapp_sessions_customerPhone_idx" ON "whatsapp_sessions"("customerPhone");`).catch(() => {});
      await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "orders_chatSessionId_idx" ON "orders"("chatSessionId");`).catch(() => {});
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "cola_impresion" (
          "id" SERIAL NOT NULL,
          "impresora_ip" TEXT,
          "payload" TEXT NOT NULL,
          "tipo" TEXT NOT NULL DEFAULT 'caja',
          "impreso" BOOLEAN NOT NULL DEFAULT false,
          "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "cola_impresion_pkey" PRIMARY KEY ("id")
        );
      `).catch(() => {});
      await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "cola_impresion_impreso_idx" ON "cola_impresion"("impreso");`).catch(() => {});

      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "custom_roles" (
          "id" TEXT NOT NULL,
          "code" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "description" TEXT,
          "color" TEXT DEFAULT '#10B981',
          "icon" TEXT DEFAULT 'Shield',
          "permissions" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "isSystem" BOOLEAN NOT NULL DEFAULT false,
          "active" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
        );
      `).catch(() => {});
      await this.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "custom_roles_code_key" ON "custom_roles"("code");`).catch(() => {});

      // Sembrar roles predeterminados si la tabla está vacía
      try {
        const count = await this.customRole.count();
        if (count === 0) {
          const defaultRoles = [
            {
              id: 'role-superadmin',
              code: 'SUPERADMIN',
              name: 'Super Administrador',
              description: 'Acceso total y configuración técnica del sistema',
              color: '#F59E0B',
              icon: 'Crown',
              permissions: ['*'],
              isSystem: true,
              active: true,
            },
            {
              id: 'role-admin',
              code: 'ADMIN',
              name: 'Administrador',
              description: 'Control administrativo completo del restaurante',
              color: '#3B82F6',
              icon: 'Shield',
              permissions: ['*'],
              isSystem: true,
              active: true,
            },
            {
              id: 'role-cashier',
              code: 'CASHIER',
              name: 'Cajero',
              description: 'Manejo de caja, cobros y pedidos POS',
              color: '#10B981',
              icon: 'UserCheck',
              permissions: [
                'orders.view', 'orders.create', 'orders.edit', 'orders.reprint',
                'dispatch.view', 'dispatch.change_status', 'customers.view', 'customers.manage',
                'cash.view', 'cash.open_close',
                'whatsapp.view', 'whatsapp.reply', 'whatsapp.media', 'whatsapp.order_create',
                'zones.view', 'drivers.view'
              ],
              isSystem: true,
              active: true,
            },
            {
              id: 'role-delivery-manager',
              code: 'DELIVERY_MANAGER',
              name: 'Gestor de Domicilios',
              description: 'Toma de pedidos en POS, asignación de domiciliarios y despacho por WhatsApp',
              color: '#8B5CF6',
              icon: 'Bike',
              permissions: [
                'orders.view', 'orders.create', 'orders.edit', 'orders.reprint', 'orders.change_driver',
                'dispatch.view', 'dispatch.change_status', 'whatsapp.view', 'whatsapp.reply',
                'whatsapp.media', 'whatsapp.assign', 'whatsapp.order_create', 'zones.view',
                'customers.view', 'customers.manage'
              ],
              isSystem: true,
              active: true,
            }
          ];

          for (const r of defaultRoles) {
            await this.customRole.upsert({
              where: { code: r.code },
              create: r,
              update: {},
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('Custom roles initial seed note:', e);
      }

    } catch (e: any) {
      console.warn('Auto-migration safeguard note:', e?.message || e);
    }
    await this.ensureDeliveryFoundation();
  }

  private async ensureDriverPortalSchema() {
    try {
      await this.$executeRawUnsafe(`
        ALTER TABLE "delivery_drivers"
        ADD COLUMN IF NOT EXISTS "userId" TEXT;
      `);
      await this.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "delivery_drivers_userId_key"
        ON "delivery_drivers"("userId");
      `);
      await this.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'delivery_drivers_userId_fkey'
          ) THEN
            ALTER TABLE "delivery_drivers"
            ADD CONSTRAINT "delivery_drivers_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
        END $$;
      `);
    } catch (error: any) {
      console.warn('Driver portal schema note:', error?.message || error);
    }
  }

  private async ensureDeliveryFoundation() {
    const advisorPermissions = [
      'orders.view', 'orders.create', 'orders.edit', 'orders.reprint',
      'whatsapp.view', 'whatsapp.reply', 'whatsapp.media', 'whatsapp.assign',
      'whatsapp.order_create', 'zones.view', 'customers.view', 'customers.manage',
    ];
    const dispatcherPermissions = [
      'orders.view', 'orders.change_driver', 'dispatch.view',
      'dispatch.change_status', 'drivers.view', 'drivers.manage', 'drivers.export',
    ];

    try {
      await this.cashRegister.updateMany({
        where: {
          purpose: 'GENERAL',
          name: { contains: 'domicil', mode: 'insensitive' },
        },
        data: { purpose: 'DELIVERY' },
      });

      const deliveryRegister = await this.cashRegister.findFirst({
        where: { purpose: 'DELIVERY' },
        select: { id: true, active: true },
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      });
      if (!deliveryRegister) {
        // El id estable hace que dos instancias iniciando a la vez converjan en
        // el mismo registro sin tocar ninguna caja que ya exista.
        await this.cashRegister.upsert({
          where: { id: 'cash-register-delivery-default' },
          create: {
            id: 'cash-register-delivery-default',
            name: 'Caja Domicilios',
            description: 'Domicilios y pedidos para recoger',
            purpose: 'DELIVERY',
            active: true,
          },
          update: { purpose: 'DELIVERY' },
        });
      } else if (!deliveryRegister.active) {
        await this.cashRegister.update({
          where: { id: deliveryRegister.id },
          data: { active: true },
        });
      }

      await this.customRole.upsert({
        where: { code: 'DELIVERY_MANAGER' },
        create: {
          code: 'DELIVERY_MANAGER',
          name: 'Gestora de Domicilios',
          description: 'Atención por WhatsApp, clientes y toma de domicilios',
          color: '#8B5CF6',
          icon: 'MessageCircle',
          permissions: advisorPermissions,
          isSystem: true,
          active: true,
        },
        update: {
          name: 'Gestora de Domicilios',
          description: 'Atención por WhatsApp, clientes y toma de domicilios',
          permissions: advisorPermissions,
          isSystem: true,
          active: true,
        },
      });

      await this.customRole.upsert({
        where: { code: 'DISPATCHER' },
        create: {
          code: 'DISPATCHER',
          name: 'Despachador de Domicilios',
          description: 'Asignación de domiciliarios, salida y entrega de pedidos',
          color: '#0EA5E9',
          icon: 'Bike',
          permissions: dispatcherPermissions,
          isSystem: true,
          active: true,
        },
        update: {
          name: 'Despachador de Domicilios',
          description: 'Asignación de domiciliarios, salida y entrega de pedidos',
          permissions: dispatcherPermissions,
          isSystem: true,
          active: true,
        },
      });

      const permissionMigration = await this.appSetting.findUnique({
        where: { key: 'delivery_roles_v1' },
      });
      if (!permissionMigration) {
        await this.user.updateMany({
          where: { role: 'DELIVERY_MANAGER' },
          data: { permissions: advisorPermissions },
        });
        await this.appSetting.create({
          data: { key: 'delivery_roles_v1', value: new Date().toISOString() },
        });
      }
    } catch (error: any) {
      console.warn('Delivery foundation note:', error?.message || error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
