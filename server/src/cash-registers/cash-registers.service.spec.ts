import { CashRegistersService } from './cash-registers.service';

describe('CashRegistersService delivery isolation', () => {
  it('summarizes only orders linked to the open delivery shift', async () => {
    const shiftStart = new Date('2026-09-05T17:00:00.000Z');
    const prisma: any = {
      cashRegister: {
        findUnique: jest.fn().mockResolvedValue({ id: 'delivery-register', purpose: 'DELIVERY' }),
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
    const socket: any = { server: { emit: jest.fn() } };
    const service = new CashRegistersService(prisma, socket);

    const summary = await service.getSummary('delivery-register');

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
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
        findUnique: jest.fn().mockResolvedValue({ id: 'delivery-register', purpose: 'DELIVERY', active: true }),
        update: jest.fn(),
      },
      cashClosing: { findFirst: jest.fn() },
    };
    const service = new CashRegistersService(prisma, { server: { emit: jest.fn() } } as any);

    await expect(service.remove('delivery-register')).rejects.toThrow('La Caja Domicilios es necesaria');
    expect(prisma.cashRegister.update).not.toHaveBeenCalled();
  });

  it('keeps a regular cash-register summary read-only when several registers are open', async () => {
    const prisma: any = {
      cashRegister: {
        findUnique: jest.fn().mockResolvedValue({ id: 'regular-register', purpose: 'GENERAL' }),
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
    const service = new CashRegistersService(prisma, { server: { emit: jest.fn() } } as any);

    await service.getSummary('regular-register');

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.diningTable.updateMany).not.toHaveBeenCalled();
    expect(prisma.cashClosing.update).not.toHaveBeenCalled();
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderType: 'LOCAL' }),
    }));
  });
});
