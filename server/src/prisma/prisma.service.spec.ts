import { PrismaService } from './prisma.service';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

describe('PrismaService multisite bootstrap', () => {
  function buildService(deliveryRegister: any) {
    const service: any = Object.create(PrismaService.prototype);
    service.cashRegister = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(deliveryRegister),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    service.customRole = {
      upsert: jest.fn().mockResolvedValue({}),
    };
    service.appSetting = {
      findUnique: jest.fn().mockResolvedValue({ id: 'delivery-roles-ready' }),
      create: jest.fn().mockResolvedValue({}),
    };
    service.user = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    return service;
  }

  it('checks and repairs the delivery register only in the principal site', async () => {
    const service = buildService({ id: 'principal-delivery', active: true });

    await service.ensureDeliveryFoundation();

    expect(service.cashRegister.updateMany).toHaveBeenCalledWith({
      where: {
        siteId: DEFAULT_SITE_ID,
        purpose: 'GENERAL',
        name: { contains: 'domicil', mode: 'insensitive' },
      },
      data: { purpose: 'DELIVERY' },
    });
    expect(service.cashRegister.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { siteId: DEFAULT_SITE_ID, purpose: 'DELIVERY' },
      }),
    );
    expect(service.cashRegister.upsert).not.toHaveBeenCalled();
  });

  it('creates the fallback delivery register explicitly in the principal site', async () => {
    const service = buildService(null);

    await service.ensureDeliveryFoundation();

    expect(service.cashRegister.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          id: 'cash-register-delivery-default',
          siteId: DEFAULT_SITE_ID,
          purpose: 'DELIVERY',
        }),
      }),
    );
  });

  it('changes the driver account index with one prepared statement per command', async () => {
    const service: any = Object.create(PrismaService.prototype);
    service.$executeRawUnsafe = jest.fn().mockResolvedValue(0);

    await service.ensureDriverPortalSchema();

    const statements = service.$executeRawUnsafe.mock.calls.map(
      ([statement]: [string]) => statement,
    );
    const dropStatement = statements.find((statement: string) =>
      statement.includes('DROP INDEX IF EXISTS "delivery_drivers_userId_key"'),
    );
    const createStatement = statements.find((statement: string) =>
      statement.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS "delivery_drivers_siteId_userId_key"',
      ),
    );

    expect(dropStatement).toBeDefined();
    expect(createStatement).toBeDefined();
    expect(dropStatement).not.toContain('CREATE UNIQUE INDEX');
    expect(createStatement).not.toContain('DROP INDEX');
  });
});
