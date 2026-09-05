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
          { total: 30_000, tip: 0, paymentMethod: 'CASH', cashAmount: 30_000, payment: null },
          { total: 25_000, tip: 0, paymentMethod: 'TRANSFER', transferAmount: 25_000, payment: null },
        ]),
      },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const socket: any = { server: { emit: jest.fn() } };
    const service = new CashRegistersService(prisma, socket);

    const summary = await service.getSummary('delivery-register');

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        cashRegisterId: 'delivery-register',
        cashClosingId: null,
        orderType: { in: ['DELIVERY', 'PICKUP'] },
        createdAt: { gte: shiftStart },
      },
      data: { cashClosingId: 'delivery-shift' },
    });
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
      orderCount: 2,
      totalSales: 55_000,
      totalCash: 30_000,
      totalTransfer: 25_000,
      cashInDrawer: 50_000,
    });
  });
});
