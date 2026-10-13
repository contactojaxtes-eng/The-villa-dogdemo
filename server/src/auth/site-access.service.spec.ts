import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  SiteAccessService,
  MULTISITE_MIGRATION_CUTOFF,
} from './site-access.service';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
} from '../common/multisite.constants';

describe('SiteAccessService', () => {
  const makeService = () => {
    const prisma: any = {
      site: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      userSiteMembership: {
        findMany: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    return { prisma, service: new SiteAccessService(prisma) };
  };

  const defaultOrg = { id: 'org-1', name: 'The Villa Dog', active: true };
  const site = {
    id: DEFAULT_SITE_ID,
    code: 'principal',
    name: 'Sede Principal',
    timezone: 'America/Bogota',
    isDefault: true,
    active: true,
    organization: defaultOrg,
  };

  const draftSite = {
    ...site,
    id: 'site-draft-1',
    code: 'draft-1',
    name: 'Sede en preparación',
    isDefault: false,
    active: false,
  };

  it('lists active and inactive sites for a global superadmin', async () => {
    const { prisma, service } = makeService();
    prisma.site.findMany.mockResolvedValue([site, draftSite]);

    const result = await service.listAvailableSites({
      id: 'super-1',
      role: 'SUPERADMIN',
      permissions: ['*'],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: DEFAULT_SITE_ID,
        role: 'SUPERADMIN',
        organizationId: 'org-1',
        active: true,
        preparationMode: false,
      }),
      expect.objectContaining({
        id: draftSite.id,
        role: 'SUPERADMIN',
        active: false,
        preparationMode: true,
      }),
    ]);
    expect(prisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization: { active: true } },
      }),
    );
    expect(prisma.userSiteMembership.findMany).not.toHaveBeenCalled();
  });

  it('allows a global superadmin to explicitly select an inactive site', async () => {
    const { prisma, service } = makeService();
    prisma.site.findMany.mockResolvedValue([site, draftSite]);

    const result = await service.resolveActiveSite(
      {
        id: 'super-1',
        role: 'SUPERADMIN',
        lastActiveSiteId: DEFAULT_SITE_ID,
      },
      draftSite.id,
    );

    expect(result.activeSite).toEqual(
      expect.objectContaining({
        id: draftSite.id,
        active: false,
        preparationMode: true,
      }),
    );
  });

  it('lists every site for the organization admin and keeps the global ADMIN scope', async () => {
    const { prisma, service } = makeService();
    prisma.site.findMany.mockResolvedValue([
      {
        ...site,
        memberships: [{ role: 'CASHIER', permissions: ['orders.view'], active: true }],
      },
      {
        ...draftSite,
        memberships: [],
      },
    ]);

    const result = await service.listAvailableSites({
      id: 'organization-admin-1',
      role: 'ADMIN',
      isOrganizationAdmin: true,
      permissions: ['*'],
    });

    expect(result).toEqual([
      expect.objectContaining({ id: DEFAULT_SITE_ID, role: 'ADMIN', active: true }),
      expect.objectContaining({ id: draftSite.id, role: 'ADMIN', preparationMode: true }),
    ]);
    expect(prisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          organization: { active: true },
        },
        include: expect.objectContaining({ memberships: expect.any(Object) }),
      }),
    );
    expect(prisma.userSiteMembership.findMany).not.toHaveBeenCalled();
  });

  it('never selects an inactive site implicitly, even if it was stored as last active', async () => {
    const { prisma, service } = makeService();
    prisma.site.findMany.mockResolvedValue([draftSite, site]);

    const result = await service.resolveActiveSite({
      id: 'super-1',
      role: 'SUPERADMIN',
      lastActiveSiteId: draftSite.id,
    });

    expect(result.activeSite.id).toBe(DEFAULT_SITE_ID);
    expect(result.activeSite.active).toBe(true);
  });

  it('uses the role and permissions from the site membership', async () => {
    const { prisma, service } = makeService();
    prisma.userSiteMembership.findMany.mockResolvedValue([
      {
        role: 'ADMIN',
        permissions: ['orders.view'],
        active: true,
        isDefault: true,
        site,
      },
    ]);

    const result = await service.resolveActiveSite({
      id: 'owner-1',
      role: 'CASHIER',
      permissions: [],
      lastActiveSiteId: DEFAULT_SITE_ID,
    });

    expect(result.activeSite).toEqual(
      expect.objectContaining({
        id: DEFAULT_SITE_ID,
        role: 'ADMIN',
        permissions: ['orders.view'],
      }),
    );
  });

  it('repairs a legacy user only into the default site', async () => {
    const { prisma, service } = makeService();
    prisma.userSiteMembership.findMany.mockResolvedValue([]);
    prisma.userSiteMembership.count.mockResolvedValue(0);
    prisma.site.findFirst.mockResolvedValue(site);
    prisma.userSiteMembership.upsert.mockResolvedValue({});

    const result = await service.listAvailableSites({
      id: 'legacy-1',
      role: 'WAITER',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(prisma.userSiteMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_siteId: { userId: 'legacy-1', siteId: DEFAULT_SITE_ID },
        },
      }),
    );
    expect(result[0].id).toBe(DEFAULT_SITE_ID);
  });

  it('does NOT repair a user whose membership was revoked', async () => {
    const { prisma, service } = makeService();
    // No active memberships
    prisma.userSiteMembership.findMany.mockResolvedValue([]);
    // But has membership records in DB (active: false)
    prisma.userSiteMembership.count.mockResolvedValue(1);

    const result = await service.listAvailableSites({
      id: 'revoked-1',
      role: 'WAITER',
    });

    expect(result).toEqual([]);
    expect(prisma.userSiteMembership.upsert).not.toHaveBeenCalled();
  });

  it('does NOT repair when memberships were deleted for a post-migration user', async () => {
    const { prisma, service } = makeService();
    prisma.userSiteMembership.findMany.mockResolvedValue([]);
    prisma.userSiteMembership.count.mockResolvedValue(0);

    const postMigrationDate = new Date(
      MULTISITE_MIGRATION_CUTOFF.getTime() + 100000,
    );
    const result = await service.listAvailableSites({
      id: 'modern-user-1',
      role: 'WAITER',
      createdAt: postMigrationDate,
    });

    expect(result).toEqual([]);
    expect(prisma.userSiteMembership.upsert).not.toHaveBeenCalled();
  });

  it('rejects switching to a site outside the membership list', async () => {
    const { prisma, service } = makeService();
    prisma.userSiteMembership.findMany.mockResolvedValue([
      {
        role: 'ADMIN',
        permissions: ['*'],
        active: true,
        isDefault: true,
        site,
      },
    ]);

    await expect(
      service.resolveActiveSite({ id: 'admin-1', role: 'ADMIN' }, 'other-site'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps inactive sites out of a regular user membership query', async () => {
    const { prisma, service } = makeService();
    prisma.userSiteMembership.findMany.mockResolvedValue([
      {
        role: 'ADMIN',
        permissions: ['*'],
        active: true,
        isDefault: true,
        site,
      },
    ]);

    const result = await service.listAvailableSites({
      id: 'admin-1',
      role: 'ADMIN',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ active: true, preparationMode: false }),
    );
    expect(prisma.userSiteMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          site: {
            active: true,
            organization: { active: true },
          },
        }),
      }),
    );
  });

  it('rejects an inactive site or a site with an inactive organization', async () => {
    const { prisma, service } = makeService();
    // Prisma query filters out inactive sites/orgs, returning empty list
    prisma.userSiteMembership.findMany.mockResolvedValue([]);
    prisma.userSiteMembership.count.mockResolvedValue(1); // was revoked/inactive

    await expect(
      service.resolveActiveSite({ id: 'user-inactive', role: 'WAITER' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('gives SUPERADMIN an explicit valid site context', async () => {
    const { prisma, service } = makeService();
    prisma.site.findMany.mockResolvedValue([site]);

    const result = await service.resolveActiveSite({
      id: 'super-admin-id',
      role: 'SUPERADMIN',
    });

    expect(result.activeSite).toBeDefined();
    expect(result.activeSite.id).toBe(DEFAULT_SITE_ID);
    expect(result.activeSite.role).toBe('SUPERADMIN');
  });
});
