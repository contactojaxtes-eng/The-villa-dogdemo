import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_ORGANIZATION,
  DEFAULT_SITE,
  DEFAULT_SITE_ID,
} from './multisite.constants';

/**
 * Completa de forma idempotente los datos base que `prisma db push` no puede
 * sembrar. La sede histórica siempre se conserva como principal y los
 * usuarios existentes reciben una única membresía inicial sin modificar
 * membresías que ya hayan sido configuradas o revocadas.
 */
@Injectable()
export class MultisiteBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MultisiteBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.ensurePrincipalSite();
  }

  async ensurePrincipalSite() {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.organization.upsert({
        where: { id: DEFAULT_ORGANIZATION.id },
        create: {
          ...DEFAULT_ORGANIZATION,
          active: true,
        },
        update: { active: true },
      });

      await tx.site.upsert({
        where: { id: DEFAULT_SITE.id },
        create: {
          ...DEFAULT_SITE,
          active: true,
          isDefault: true,
        },
        update: {
          organizationId: DEFAULT_SITE.organizationId,
          active: true,
          isDefault: true,
        },
      });

      // El traspaso de usuarios históricos debe ejecutarse exactamente una
      // vez. Volver a recorrer todos los usuarios en cada arranque concedería
      // acceso a la sede principal a cuentas creadas después para otra sede.
      const principalMembershipMarker = await tx.appSetting.findUnique({
        where: { key: 'multisite_principal_memberships_initialized' },
        select: { value: true },
      });
      let usersFound = 0;
      let usersAssigned = 0;
      if (!principalMembershipMarker) {
        const legacyUsers = await tx.user.findMany({
          select: {
            id: true,
            role: true,
            permissions: true,
            active: true,
          },
        });
        usersFound = legacyUsers.length;
        if (legacyUsers.length > 0) {
          const assigned = await tx.userSiteMembership.createMany({
            data: legacyUsers.map((user) => ({
              userId: user.id,
              siteId: DEFAULT_SITE_ID,
              role: user.role,
              permissions: user.permissions ?? Prisma.DbNull,
              active: user.active,
              isDefault: true,
            })),
            skipDuplicates: true,
          });
          usersAssigned = assigned.count;
          await tx.user.updateMany({
            where: {
              id: { in: legacyUsers.map((user) => user.id) },
              lastActiveSiteId: null,
            },
            data: { lastActiveSiteId: DEFAULT_SITE_ID },
          });
        }
        await tx.appSetting.upsert({
          where: { key: 'multisite_principal_memberships_initialized' },
          create: {
            key: 'multisite_principal_memberships_initialized',
            value: new Date().toISOString(),
          },
          update: {},
        });
      }

      // Reconocer al administrador general también es una operación única,
      // pero nunca se promueven todos los ADMIN. Si hay exactamente uno se
      // conserva automáticamente. Cuando hay varios, Railway debe declarar
      // ORGANIZATION_ADMIN_EMAILS con uno o más correos autorizados.
      const organizationAdminMarker = await tx.appSetting.findUnique({
        where: { key: 'multisite_organization_admin_initialized' },
        select: { value: true },
      });
      let organizationAdminsPromoted = 0;
      let organizationAdminNeedsSelection = false;
      if (!organizationAdminMarker) {
        const configuredEmails = [
          ...new Set(
            String(process.env.ORGANIZATION_ADMIN_EMAILS || '')
              .split(',')
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
        const existingOrganizationAdmins = await tx.user.count({
          where: { isOrganizationAdmin: true, active: true },
        });
        let selectedIds: string[] = [];
        if (existingOrganizationAdmins > 0) {
          selectedIds = [];
        } else {
          const candidates = await tx.user.findMany({
            where: {
              role: 'ADMIN',
              active: true,
              isOrganizationAdmin: false,
              ...(configuredEmails.length > 0
                ? { email: { in: configuredEmails, mode: 'insensitive' } }
                : {}),
            },
            select: { id: true, email: true },
            orderBy: { createdAt: 'asc' },
          });
          if (configuredEmails.length > 0) {
            const foundEmails = new Set(
              candidates.map((candidate) => candidate.email.trim().toLowerCase()),
            );
            if (configuredEmails.every((email) => foundEmails.has(email))) {
              selectedIds = candidates.map((candidate) => candidate.id);
            } else {
              organizationAdminNeedsSelection = true;
            }
          } else if (candidates.length === 1) {
            selectedIds = [candidates[0].id];
          } else {
            organizationAdminNeedsSelection = true;
          }
        }

        if (!organizationAdminNeedsSelection) {
          if (selectedIds.length > 0) {
            const promoted = await tx.user.updateMany({
              where: { id: { in: selectedIds }, isOrganizationAdmin: false },
              data: { isOrganizationAdmin: true },
            });
            organizationAdminsPromoted = promoted.count;
          }
          await tx.appSetting.upsert({
            where: { key: 'multisite_organization_admin_initialized' },
            create: {
              key: 'multisite_organization_admin_initialized',
              value: new Date().toISOString(),
            },
            update: {},
          });
        }
      }

      if (organizationAdminNeedsSelection) {
        this.logger.warn(
          'No se promovió ningún ADMIN general. Define ORGANIZATION_ADMIN_EMAILS con los correos autorizados y reinicia.',
        );
      }

      const legacyZoneGroups = await tx.appSetting.findUnique({
        where: { key: 'delivery_zone_groups' },
        select: { value: true },
      });
      if (legacyZoneGroups?.value) {
        await tx.siteSetting.upsert({
          where: {
            siteId_key: {
              siteId: DEFAULT_SITE_ID,
              key: 'delivery_zone_groups',
            },
          },
          create: {
            siteId: DEFAULT_SITE_ID,
            key: 'delivery_zone_groups',
            value: legacyZoneGroups.value,
          },
          update: {},
        });
      }

      // `server.js` usa `prisma db push` en Railway y, por diseño, no ejecuta
      // los archivos de migración. Materializamos aquí la cuenta Meta pública
      // de la sede principal a partir de la configuración histórica. Los
      // secretos siguen en AppSetting/env y nunca se copian a esta tabla.
      const legacyWhatsAppSettings = await tx.appSetting.findMany({
        where: {
          key: {
            in: [
              'whatsapp_phone_id',
              'whatsapp_business_account_id',
              'whatsapp_business_phone',
            ],
          },
        },
        select: { key: true, value: true },
      });
      const legacyWhatsApp = Object.fromEntries(
        legacyWhatsAppSettings.map((setting) => [setting.key, String(setting.value || '').trim()]),
      );
      if (legacyWhatsApp.whatsapp_phone_id) {
        await tx.whatsAppAccount.upsert({
          where: { siteId: DEFAULT_SITE_ID },
          create: {
            id: '00000000-0000-4000-8000-000000000301',
            siteId: DEFAULT_SITE_ID,
            phoneNumberId: legacyWhatsApp.whatsapp_phone_id,
            businessAccountId: legacyWhatsApp.whatsapp_business_account_id || null,
            displayPhoneNumber: legacyWhatsApp.whatsapp_business_phone || null,
            active: true,
          },
          // No cambiar silenciosamente una cuenta que ya fue configurada por
          // administración; la actualización de credenciales se hace desde
          // el módulo de sedes.
          update: {},
        });
      }

      return {
        usersFound,
        usersAssigned,
        organizationAdminsPromoted,
      };
    });

    // Prisma no representa índices parciales en schema.prisma. Se crean de
    // forma segura después del backfill para impedir dos sedes principales o
    // dos membresías predeterminadas para la misma persona.
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "sites_one_default_per_organization_idx"
      ON "sites"("organizationId") WHERE "isDefault" = true;
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_site_memberships_one_default_per_user_idx"
      ON "user_site_memberships"("userId") WHERE "isDefault" = true;
    `);

    this.logger.log(
      `Sede principal verificada; ${result.usersFound} usuarios revisados, ${result.usersAssigned} activados en su sede inicial y ${result.organizationAdminsPromoted} administradores generales reconocidos.`,
    );
  }
}
