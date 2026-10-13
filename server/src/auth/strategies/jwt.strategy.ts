import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
} from '../../common/multisite.constants';

type JwtPayload = {
  sub: string;
  email: string;
  role?: string;
  siteId?: string;
  organizationId?: string;
  siteActive?: boolean;
  preparationMode?: boolean;
  globalRole?: string | null;
  isOrganizationAdmin?: boolean;
  type?: string;
  impersonatedBy?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_SECRET || 'change-me-the-villa-dog-dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type === 'refresh')
      throw new UnauthorizedException('Usa un token de acceso');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        siteMemberships: {
          where: {
            active: true,
            ...(payload.siteId ? { siteId: payload.siteId } : {}),
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
          take: 1,
        },
        lastActiveSite: {
          include: {
            organization: {
              select: { id: true, name: true, active: true },
            },
          },
        },
      },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Usuario no encontrado o inactivo');
    }
    const memberships = Array.isArray((user as any).siteMemberships)
      ? (user as any).siteMemberships
      : null;
    const membership = memberships?.[0];
    let site = membership?.site;

    const isOrganizationAdmin = (user as any).isOrganizationAdmin === true;
    const isGlobalSiteManager = user.role === 'SUPERADMIN' || isOrganizationAdmin;

    // Una membresía accidental o histórica de otra organización no amplía el
    // alcance del ADMIN_GENERAL. El SuperAdmin sí conserva alcance técnico
    // global para soporte.
    if (
      isOrganizationAdmin &&
      site &&
      site.organizationId !== DEFAULT_ORGANIZATION_ID
    ) {
      site = undefined;
    }

    if (isGlobalSiteManager && !site) {
      if (payload.siteId) {
        const found = await this.prisma.site.findFirst({
          where: {
            id: payload.siteId,
            ...(user.role === 'SUPERADMIN'
              ? {}
              : { organizationId: DEFAULT_ORGANIZATION_ID }),
            organization: { active: true },
          },
          include: {
            organization: { select: { id: true, name: true, active: true } },
          },
        });
        if (found) site = found;
      } else if (
        (user as any).lastActiveSite?.active &&
        (user as any).lastActiveSite?.organization?.active
      ) {
        site = (user as any).lastActiveSite;
      } else {
        const defaultSite = await this.prisma.site.findFirst({
          where: {
            isDefault: true,
            active: true,
            organization: { active: true },
          },
          include: {
            organization: { select: { id: true, name: true, active: true } },
          },
        });
        if (defaultSite) site = defaultSite;
      }
    }

    // Token heredado sin siteId: solo cae en Sede Principal durante la transición si no se especificó otra sede
    if (!site && !payload.siteId) {
      if (memberships === null) {
        site = {
          id: DEFAULT_SITE_ID,
          organizationId: DEFAULT_ORGANIZATION_ID,
          code: 'principal',
          name: 'Sede Principal',
          timezone: 'America/Bogota',
          active: true,
          isDefault: true,
          organization: {
            id: DEFAULT_ORGANIZATION_ID,
            name: 'The Villa Dog',
            active: true,
          },
        };
      }
    }

    if (!site) {
      throw new UnauthorizedException(
        'No tienes acceso a la sede de esta sesión',
      );
    }

    if (site.active === false && !isGlobalSiteManager) {
      throw new UnauthorizedException(
        'No tienes acceso a la sede de esta sesión',
      );
    }

    const siteActive = site.active !== false;
    const preparationMode = !siteActive;

    const effectiveRole =
      user.role === 'SUPERADMIN'
        ? 'SUPERADMIN'
        : isOrganizationAdmin
          ? 'ADMIN'
          : membership?.role || user.role;
    const effectivePermissions =
      user.role === 'SUPERADMIN' || isOrganizationAdmin
        ? user.permissions
        : (membership?.permissions ?? user.permissions);

    const globalRole = user.role === 'SUPERADMIN'
      ? 'SUPERADMIN'
      : isOrganizationAdmin
        ? 'ADMIN_GENERAL'
        : null;

    return {
      id: user.id,
      email: user.email,
      role: effectiveRole,
      globalRole,
      isOrganizationAdmin,
      name: user.name,
      permissions: effectivePermissions,
      siteId: site.id,
      organizationId: site.organizationId || site.organization?.id,
      siteActive,
      preparationMode,
      site: {
        id: site.id,
        code: site.code,
        name: site.name,
        timezone: site.timezone,
        organizationId: site.organizationId || site.organization?.id,
        organizationName: site.organization?.name,
        active: siteActive,
        preparationMode,
      },
      impersonatedBy: payload.impersonatedBy,
    };
  }
}
