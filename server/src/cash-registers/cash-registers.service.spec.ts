import { CashRegistersService } from './cash-registers.service';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

const SECOND_SITE_ID = '00000000-0000-4000-8000-000000000102';

describe('CashRegistersService delivery isolation', () => {
  it('summarizes only orders linked to the open delivery shift', async () => {
    const shiftStart = new Date('2026-09-05T17:00:00.000Z');
    const prisma: any = {
      cashRegister: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-register', purpose: 'DELIVERY' }),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'delivery-shift',
          cashRegisterId: 'delivery-register',
          userId: 'advisor-1',
          initialCash: 20_000,
          shiftStart,
          user: { id: 'advisor-1', name: 'Ana' },
        }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([
          { orderType: 'DELIVERY', total: 30_000, tip: 0, status: 'DELIVERED', paymentStatus: 'CONFIRMED', paymentMethod: 'CASH', cashAmount: 30_000, payment: null },
          { orderType: 'PICKUP', total: 25_000, tip: 0, status: 'DELIVERED', paymentStatus: 'CONFIRMED', paymentMethod: 'NEQUI', transferAmount: 25_000, payment: null },
          { orderType: 'DELIVERY', total: 12_000, tip: 0, status: 'DELIVERED', paymentStatus: 'DRIVER_CASH_PENDING', paymentMethod: 'CASH', cashAmount: 12_000, payment: null },
        ]),
      },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const socket: any = { emitToSite: jest.fn() };
    const service = new CashRegistersService(prisma, socket);

    const summary = await service.getSummary('delivery-register');

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        siteId: DEFAULT_SITE_ID,
        cashClosingId: 'delivery-shift',
        cashRegisterId: 'delivery-register',
        orderType: { in: ['DELIVERY', 'PICKUP'] },
        status: { not: 'CANCELLED' },
      },
      include: { payment: true },
    });
    expect(summary).toMatchObject({
      orderCount: 3,
      deliveryCount: 2,
      pickupCount: 1,
      paidOrderCount: 2,
      pendingPaymentCount: 1,
      pendingPaymentAmount: 12_000,
      totalSales: 67_000,
      totalCollected: 55_000,
      totalCash: 30_000,
      pendingDriverCash: 12_000,
      totalTransfer: 0,
      totalNequi: 25_000,
      cashInDrawer: 50_000,
    });
  });

  it('keeps the required delivery register active and preserves its history', async () => {
    const prisma: any = {
      cashRegister: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-register', purpose: 'DELIVERY', active: true }),
        update: jest.fn(),
      },
      cashClosing: { findFirst: jest.fn() },
    };
    const service = new CashRegistersService(prisma, { emitToSite: jest.fn() } as any);

    await expect(service.remove('delivery-register')).rejects.toThrow('La Caja Domicilios es necesaria');
    expect(prisma.cashRegister.update).not.toHaveBeenCalled();
  });

  it('keeps a regular cash-register summary read-only when several registers are open', async () => {
    const prisma: any = {
      cashRegister: {
        findFirst: jest.fn().mockResolvedValue({ id: 'regular-register', purpose: 'GENERAL' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'regular-shift',
          cashRegisterId: 'regular-register',
          userId: 'cashier-1',
          initialCash: 10_000,
          shiftStart: new Date('2026-09-08T14:00:00.000Z'),
          user: { id: 'cashier-1', name: 'Luis' },
        }),
        update: jest.fn(),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      diningTable: { updateMany: jest.fn() },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CashRegistersService(prisma, { emitToSite: jest.fn() } as any);

    await service.getSummary('regular-register');

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.diningTable.updateMany).not.toHaveBeenCalled();
    expect(prisma.cashClosing.update).not.toHaveBeenCalled();
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ siteId: DEFAULT_SITE_ID, orderType: 'LOCAL' }),
    }));
  });

  it('creates one delivery register per site and emits only to that site', async () => {
    const created = { id: 'delivery-b', siteId: SECOND_SITE_ID, purpose: 'DELIVERY' };
    const prisma: any = {
      cashRegister: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const socket: any = { emitToSite: jest.fn() };
    const service = new CashRegistersService(prisma, socket);

    await expect(service.create({ name: 'Domicilios', purpose: 'DELIVERY' }, SECOND_SITE_ID)).resolves.toBe(created);
    expect(prisma.cashRegister.findFirst).toHaveBeenCalledWith({
      where: { siteId: SECOND_SITE_ID, purpose: 'DELIVERY', active: true },
      select: { id: true },
    });
    expect(prisma.cashRegister.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ siteId: SECOND_SITE_ID, purpose: 'DELIVERY' }),
    }));
    expect(socket.emitToSite).toHaveBeenCalledWith(SECOND_SITE_ID, 'cashRegistersChanged');
  });

  it('does not expose a cash register from another site', async () => {
    const prisma: any = {
      cashRegister: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new CashRegistersService(prisma, { emitToSite: jest.fn() } as any);

    await expect(service.findOne('principal-register', SECOND_SITE_ID)).rejects.toThrow('Caja no encontrada');
    expect(prisma.cashRegister.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'principal-register', siteId: SECOND_SITE_ID },
    }));
  });

  it('rejects a manager without an active membership in the site', async () => {
    const prisma: any = {
      userSiteMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      cashRegister: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new CashRegistersService(prisma, { emitToSite: jest.fn() } as any);

    await expect(service.create({ name: 'Caja 2', managerId: 'manager-principal' }, SECOND_SITE_ID))
      .rejects.toThrow('El responsable no pertenece a esta sede');
    expect(prisma.cashRegister.create).not.toHaveBeenCalled();
  });

  it('filters manual sales by the active site', async () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CashRegistersService(prisma, { emitToSite: jest.fn() } as any);

    await service.getSummary('manual', undefined, SECOND_SITE_ID);
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ siteId: SECOND_SITE_ID, cashRegisterId: null }),
    }));
  });
});
