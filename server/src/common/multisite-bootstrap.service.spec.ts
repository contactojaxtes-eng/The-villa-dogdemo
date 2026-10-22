import { MultisiteBootstrapService } from './multisite-bootstrap.service';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
} from './multisite.constants';

describe('MultisiteBootstrapService', () => {
  let prisma: any;
  let tx: any;
  let service: MultisiteBootstrapService;

  beforeEach(() => {
    tx = {
      organization: { upsert: jest.fn().mockResolvedValue({}) },
      site: { upsert: jest.fn().mockResolvedValue({}) },
      user: {
        findMany: jest.fn().mockImplementation(({ where }: any = {}) => {
          if (where?.role === 'ADMIN') {
            return Promise.resolve([
              { id: 'legacy-admin', email: 'admin@thevilladog.local' },
            ]);
          }
          return Promise.resolve([
            {
              id: 'legacy-user',
              role: 'CASHIER',
              permissions: ['orders.view'],
              active: true,
            },
          ]);
        }),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userSiteMembership: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      appSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      siteSetting: { upsert: jest.fn().mockResolvedValue({}) },
      whatsAppAccount: { upsert: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((callback: any) => callback(tx)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    service = new MultisiteBootstrapService(prisma);
  });

  it('creates the principal tenant and assigns legacy users without overwriting memberships', async () => {
    await service.ensurePrincipalSite();

    expect(tx.organization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEFAULT_ORGANIZATION_ID },
        update: { name: 'Demo JAXTES', active: true },
      }),
    );
    expect(tx.site.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEFAULT_SITE_ID },
        update: expect.objectContaining({ active: true, isDefault: true }),
      }),
    );
    expect(tx.userSiteMembership.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'legacy-user',
          siteId: DEFAULT_SITE_ID,
          role: 'CASHIER',
          active: true,
          isDefault: true,
        }),
      ],
      skipDuplicates: true,
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['legacy-user'] },
        lastActiveSiteId: null,
      },
      data: { lastActiveSiteId: DEFAULT_SITE_ID },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['legacy-admin'] }, isOrganizationAdmin: false },
      data: { isOrganizationAdmin: true },
    });
    expect(tx.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'multisite_organization_admin_initialized' },
      }),
    );
    expect(tx.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'multisite_principal_memberships_initialized' },
      }),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('copies the legacy zone grouping only when the site has no value yet', async () => {
    tx.appSetting.findUnique.mockImplementation(({ where }: any) =>
      where?.key === 'delivery_zone_groups'
        ? Promise.resolve({ value: '[{"name":"Centro"}]' })
        : Promise.resolve({ value: new Date().toISOString() }),
    );

    await service.ensurePrincipalSite();

    expect(tx.siteSetting.upsert).toHaveBeenCalledWith({
      where: {
        siteId_key: {
          siteId: DEFAULT_SITE_ID,
          key: 'delivery_zone_groups',
        },
      },
      create: {
        siteId: DEFAULT_SITE_ID,
        key: 'delivery_zone_groups',
        value: '[{"name":"Centro"}]',
      },
      update: {},
    });
  });

  it('does not write empty membership batches or invent a zone configuration', async () => {
    tx.user.findMany.mockResolvedValue([]);
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    tx.appSetting.findUnique.mockImplementation(({ where }: any) =>
      where?.key === 'multisite_organization_admin_initialized'
        ? Promise.resolve({ value: new Date().toISOString() })
        : Promise.resolve(null),
    );

    await service.ensurePrincipalSite();

    expect(tx.userSiteMembership.createMany).not.toHaveBeenCalled();
    expect(tx.siteSetting.upsert).not.toHaveBeenCalled();
  });

  it('never grants the principal site again after the one-time membership marker exists', async () => {
    tx.appSetting.findUnique.mockImplementation(({ where }: any) => {
      if (where?.key === 'multisite_principal_memberships_initialized') {
        return Promise.resolve({ value: new Date().toISOString() });
      }
      if (where?.key === 'multisite_organization_admin_initialized') {
        return Promise.resolve({ value: new Date().toISOString() });
      }
      return Promise.resolve(null);
    });

    await service.ensurePrincipalSite();

    expect(tx.user.findMany).not.toHaveBeenCalled();
    expect(tx.userSiteMembership.createMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('does not promote every existing ADMIN when more than one candidate exists', async () => {
    const previous = process.env.ORGANIZATION_ADMIN_EMAILS;
    delete process.env.ORGANIZATION_ADMIN_EMAILS;
    tx.user.findMany.mockImplementation(({ where }: any = {}) => {
      if (where?.role === 'ADMIN') {
        return Promise.resolve([
          { id: 'admin-1', email: 'uno@thevilladog.local' },
          { id: 'admin-2', email: 'dos@thevilladog.local' },
        ]);
      }
      return Promise.resolve([]);
    });
    try {
      await service.ensurePrincipalSite();
    } finally {
      if (previous === undefined) delete process.env.ORGANIZATION_ADMIN_EMAILS;
      else process.env.ORGANIZATION_ADMIN_EMAILS = previous;
    }

    expect(tx.user.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isOrganizationAdmin: true },
      }),
    );
    expect(tx.appSetting.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'multisite_organization_admin_initialized' },
      }),
    );
  });
});
