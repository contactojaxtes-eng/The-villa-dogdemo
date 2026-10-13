import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
} from '../../common/multisite.constants';

describe('JwtStrategy multisite context', () => {
  const site = {
    id: DEFAULT_SITE_ID,
    code: 'principal',
    name: 'Sede Principal',
    timezone: 'America/Bogota',
    organizationId: 'org-1',
    active: true,
    isDefault: true,
    organization: { id: 'org-1', name: 'The Villa Dog', active: true },
  };

  const baseUser = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Usuario',
    role: 'CASHIER',
    permissions: ['cash.view'],
    active: true,
    lastActiveSite: site,
  };

  it('rejects a refresh token used as access token', async () => {
    const prisma: any = {};
    const strategy = new JwtStrategy(prisma);

    await expect(
      strategy.validate({
        sub: baseUser.id,
        email: baseUser.email,
        type: 'refresh',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the effective membership role and signed site context', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseUser,
          siteMemberships: [{ role: 'ADMIN', permissions: ['*'], site }],
        }),
      },
    };
    const strategy = new JwtStrategy(prisma);

    const result = await strategy.validate({
      sub: baseUser.id,
      email: baseUser.email,
      siteId: DEFAULT_SITE_ID,
      organizationId: 'org-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: baseUser.id,
        role: 'ADMIN',
        permissions: ['*'],
        siteId: DEFAULT_SITE_ID,
        organizationId: 'org-1',
        siteActive: true,
        preparationMode: false,
      }),
    );
    expect(result.site).toEqual(
      expect.objectContaining({ active: true, preparationMode: false }),
    );
  });

  it('rejects a token for a site without an active membership', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseUser,
          lastActiveSite: null,
          siteMemberships: [],
        }),
      },
    };
    const strategy = new JwtStrategy(prisma);

    await expect(
      strategy.validate({
        sub: baseUser.id,
        email: baseUser.email,
        siteId: 'other-site',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('legacy token without siteId falls back to Sede Principal during transition', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseUser,
          siteMemberships: null, // legacy un-migrated representation
        }),
      },
    };
    const strategy = new JwtStrategy(prisma);

    const result = await strategy.validate({
      sub: baseUser.id,
      email: baseUser.email,
    });

    expect(result.siteId).toBe(DEFAULT_SITE_ID);
    expect(result.site.name).toBe('Sede Principal');
  });

  it('SUPERADMIN receives explicit and valid site context even without membership', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'super-1',
          email: 'super@thevilladog.com',
          name: 'Super Admin',
          role: 'SUPERADMIN',
          permissions: ['*'],
          active: true,
          siteMemberships: [],
          lastActiveSite: site,
        }),
      },
      site: {
        findFirst: jest.fn().mockResolvedValue(site),
      },
    };
    const strategy = new JwtStrategy(prisma);

    const result = await strategy.validate({
      sub: 'super-1',
      email: 'super@thevilladog.com',
      siteId: DEFAULT_SITE_ID,
    });

    expect(result.role).toBe('SUPERADMIN');
    expect(result.globalRole).toBe('SUPERADMIN');
    expect(result.siteId).toBe(DEFAULT_SITE_ID);
  });

  it('keeps the organization admin as ADMIN even if a site membership has an operational role', async () => {
    const site = {
      id: 'site-2',
      organizationId: DEFAULT_ORGANIZATION_ID,
      code: 'norte',
      name: 'Sede Norte',
      timezone: 'America/Bogota',
      active: true,
      isDefault: false,
      organization: { id: DEFAULT_ORGANIZATION_ID, name: 'The Villa Dog', active: true },
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-admin-1',
          email: 'admin@thevilladog.com',
          role: 'ADMIN',
          isOrganizationAdmin: true,
          permissions: ['*'],
          active: true,
          siteMemberships: [{ role: 'CASHIER', permissions: ['orders.view'], site }],
          lastActiveSite: null,
        }),
      },
    };
    const strategy = new JwtStrategy(prisma);

    const result = await strategy.validate({
      sub: 'org-admin-1',
      email: 'admin@thevilladog.com',
      siteId: 'site-2',
    });

    expect(result.role).toBe('ADMIN');
    expect(result.globalRole).toBe('ADMIN_GENERAL');
    expect(result.permissions).toEqual(['*']);
  });

  it('does not let an organization admin enter a site from another organization', async () => {
    const foreignSite = {
      id: 'foreign-site',
      organizationId: 'foreign-organization',
      code: 'foreign',
      name: 'Otra organización',
      timezone: 'America/Bogota',
      active: true,
      isDefault: false,
      organization: {
        id: 'foreign-organization',
        name: 'Otro negocio',
        active: true,
      },
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-admin-1',
          email: 'admin@thevilladog.com',
          role: 'ADMIN',
          isOrganizationAdmin: true,
          permissions: ['*'],
          active: true,
          siteMemberships: [{ role: 'ADMIN', permissions: ['*'], site: foreignSite }],
          lastActiveSite: null,
        }),
      },
      site: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const strategy = new JwtStrategy(prisma);

    await expect(
      strategy.validate({
        sub: 'org-admin-1',
        email: 'admin@thevilladog.com',
        siteId: foreignSite.id,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: foreignSite.id,
          organizationId: DEFAULT_ORGANIZATION_ID,
        }),
      }),
    );
  });

  it('allows only a database SUPERADMIN to use an inactive site context', async () => {
    const draftSite = {
      ...site,
      id: 'site-draft-1',
      code: 'draft-1',
      name: 'Sede en preparación',
      isDefault: false,
      active: false,
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'super-1',
          email: 'super@thevilladog.com',
          name: 'Super Admin',
          role: 'SUPERADMIN',
          permissions: ['*'],
          active: true,
          siteMemberships: [],
          lastActiveSite: site,
        }),
      },
      site: {
        findFirst: jest.fn().mockResolvedValue(draftSite),
      },
    };
    const strategy = new JwtStrategy(prisma);

    const result = await strategy.validate({
      sub: 'super-1',
      email: 'super@thevilladog.com',
      role: 'SUPERADMIN',
      siteId: draftSite.id,
      siteActive: true,
      preparationMode: false,
    });

    expect(result).toEqual(
      expect.objectContaining({
        siteId: draftSite.id,
        siteActive: false,
        preparationMode: true,
      }),
    );
    expect(result.site).toEqual(
      expect.objectContaining({ active: false, preparationMode: true }),
    );
  });

  it('does not trust SUPERADMIN or preparation claims for a regular database user', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseUser,
          lastActiveSite: null,
          siteMemberships: [],
        }),
      },
    };
    const strategy = new JwtStrategy(prisma);

    await expect(
      strategy.validate({
        sub: baseUser.id,
        email: baseUser.email,
        role: 'SUPERADMIN',
        siteId: 'site-draft-1',
        siteActive: true,
        preparationMode: false,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
