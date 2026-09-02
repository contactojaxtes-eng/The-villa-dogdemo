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
    // Production schema changes must run through reviewed migrations.
    if (process.env.NODE_ENV === 'production') return;
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
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
