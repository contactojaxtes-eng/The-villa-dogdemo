import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
} from '../common/multisite.constants';
import { DEFAULT_ROLE_PERMISSIONS } from './permissions.constant';

export const MULTISITE_MIGRATION_CUTOFF = new Date('2026-09-24T15:00:00.000Z');

export type UserForSiteAccess = {
  id: string;
  role: string;
  isOrganizationAdmin?: boolean;
  permissions?: unknown;
  lastActiveSiteId?: string | null;
  createdAt?: Date;
  isLegacy?: boolean;
};

export type AvailableSite = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  organizationId: string;
  organizationName: string;
  role: string;
  permissions: unknown;
  isDefault: boolean;
  active: boolean;
  preparationMode: boolean;
};

@Injectable()
export class SiteAccessService {
  constructor(private prisma: PrismaService) {}

  async listAvailableSites(user: UserForSiteAccess): Promise<AvailableSite[]> {
    if (user.role === 'SUPERADMIN') {
      const sites = await this.prisma.site.findMany({
        where: {
          organization: { active: true },
        },
        include: {
          organization: {
            select: { id: true, name: true, active: true },
          },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return sites.map((site) => ({
        id: site.id,
        code: site.code,
        name: site.name,
        timezone: site.timezone,
        organizationId: site.organization.id,
        organizationName: site.organization.name,
        role: 'SUPERADMIN',
        permissions: user.permissions ?? ['*'],
        isDefault: site.isDefault,
        active: site.active,
        preparationMode: !site.active,
      }));
    }

    // El ADMIN histórico de la organización conserva el control general. No
    // depende de una membresía manual en cada sede y puede preparar
    // borradores; los ADMIN creados posteriormente no entran en esta rama.
    if (user.isOrganizationAdmin === true) {
      const sites = await this.prisma.site.findMany({
        where: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          organization: { active: true },
        },
        include: {
          organization: {
            select: { id: true, name: true, active: true },
          },
          memberships: {
            where: { userId: user.id },
            select: { role: true, permissions: true, active: true },
            take: 1,
          },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return sites.map((site) => {
        const membership = site.memberships[0];
        return {
          id: site.id,
          code: site.code,
          name: site.name,
          timezone: site.timezone,
          organizationId: site.organization.id,
          organizationName: site.organization.name,
          // El ADMIN histórico conserva el alcance de organización aunque
          // exista una membresía con un rol operativo distinto en una sede.
          // La membresía limita los permisos opcionales, pero nunca degrada
          // su capacidad de cambiar de sede y preparar otra.
          role: 'ADMIN',
          permissions:
            membership?.permissions ??
            user.permissions ??
            DEFAULT_ROLE_PERMISSIONS.ADMIN,
          isDefault: site.isDefault,
          active: site.active,
          preparationMode: !site.active,
        };
      });
    }

    // 1. Obtener membresías activas en sedes y organizaciones activas
    let memberships = await this.prisma.userSiteMembership.findMany({
      where: {
        userId: user.id,
        active: true,
        site: {
          active: true,
          organization: { active: true },
        },
      },
      include: {
        site: {
          include: {
            organization: {
              select: { id: true, name: true, active: true },
            },
          },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    if (memberships.length > 0) {
      return memberships.map((membership) => ({
        id: membership.site.id,
        code: membership.site.code,
        name: membership.site.name,
        timezone: membership.site.timezone,
        organizationId: membership.site.organization.id,
        organizationName: membership.site.organization.name,
        role: membership.role || user.role,
        permissions: membership.permissions ?? user.permissions ?? null,
        isDefault: membership.isDefault || membership.site.isDefault,
        active: true,
        preparationMode: false,
      }));
    }

    // 2. Si no tiene membresías activas:
    // Comprobar si tiene registros de membresía históricos o inactivos (revocados)
    const totalMemberships = await this.prisma.userSiteMembership.count({
      where: { userId: user.id },
    });

    // Si existen membresías pero ninguna está activa, están revocadas -> no conceder acceso
    if (totalMemberships > 0) {
      return [];
    }

    // 3. Si tiene 0 registros de membresía:
    // Solo se autorrepara si es un usuario verdaderamente heredado (creado antes o durante la migración)
    let createdAt = user.createdAt;
    if (!createdAt && this.prisma.user?.findUnique) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { createdAt: true, lastActiveSiteId: true },
      });
      createdAt = dbUser?.createdAt;
    }

    // Un usuario es heredado real solo si su fecha de creación es anterior o igual a la migración
    const isLegacyUser = createdAt
      ? new Date(createdAt).getTime() <= MULTISITE_MIGRATION_CUTOFF.getTime()
      : user.id.startsWith('legacy') || Boolean(user.isLegacy);

    if (!isLegacyUser) {
      // Eliminar todas las membresías a un usuario nuevo o pos-migración NO vuelve a conceder acceso
      return [];
    }

    // Verificar que Sede Principal exista y esté activa con organización activa
    const defaultSite = await this.prisma.site.findFirst({
      where: {
        id: DEFAULT_SITE_ID,
        active: true,
        organization: { active: true },
      },
      include: {
        organization: {
          select: { id: true, name: true, active: true },
        },
      },
    });

    if (!defaultSite) {
      return [];
    }

    // Reparar usuario heredado asignándolo a Sede Principal
    await this.prisma.userSiteMembership.upsert({
      where: {
        userId_siteId: {
          userId: user.id,
          siteId: DEFAULT_SITE_ID,
        },
      },
      create: {
        userId: user.id,
        siteId: DEFAULT_SITE_ID,
        role: user.role,
        permissions: (user.permissions as any) ?? undefined,
        active: true,
        isDefault: true,
      },
      update: { active: true },
    });

    return [
      {
        id: defaultSite.id,
        code: defaultSite.code,
        name: defaultSite.name,
        timezone: defaultSite.timezone,
        organizationId: defaultSite.organization.id,
        organizationName: defaultSite.organization.name,
        role: user.role,
        permissions: user.permissions ?? null,
        isDefault: true,
        active: true,
        preparationMode: false,
      },
    ];
  }

  async resolveActiveSite(
    user: UserForSiteAccess,
    requestedSiteId?: string | null,
  ) {
    const sites = await this.listAvailableSites(user);
    if (sites.length === 0) {
      throw new UnauthorizedException(
        'Tu usuario no tiene una sede activa asignada',
      );
    }

    const requested = String(requestedSiteId || '').trim();
    if (requested) {
      const selected = sites.find((site) => site.id === requested);
      if (!selected)
        throw new ForbiddenException('No tienes acceso a la sede seleccionada');
      return { activeSite: selected, sites };
    }

    const selected =
      sites.find((site) => site.active && site.id === user.lastActiveSiteId) ||
      sites.find((site) => site.active && site.isDefault) ||
      sites.find((site) => site.active);
    if (!selected) {
      throw new UnauthorizedException(
        'Tu usuario no tiene una sede activa asignada',
      );
    }
    return { activeSite: selected, sites };
  }

  rememberActiveSite(userId: string, siteId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastActiveSiteId: siteId },
      select: { id: true },
    });
  }
}
