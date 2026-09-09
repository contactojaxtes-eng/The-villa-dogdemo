import { PaymentsService } from './payments.service';

describe('PaymentsService delivery cash isolation', () => {
  const makeService = (overrides: Record<string, any> = {}) => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'cashier-1', role: 'CASHIER' }) },
      payment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'payment-1', orderId: 'order-1' }),
        update: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'CONFIRMED' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ cashClosingId: null, cashRegisterId: null, orderType: 'DELIVERY' }),
        update: jest.fn().mockResolvedValue({ id: 'order-1', customerPhone: null }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-closing', cashRegisterId: 'delivery-register' }),
        findUnique: jest.fn(),
      },
      cashRegister: { findUnique: jest.fn() },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      customerPayment: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
    const socket: any = { server: { emit: jest.fn() } };
    const whatsapp: any = { unassignSessionByPhone: jest.fn().mockResolvedValue(undefined) };
    return { prisma, socket, service: new PaymentsService(prisma, socket, whatsapp) };
  };

  it('confirms a delivery payment in the active delivery shift, not the cashier personal shift', async () => {
    const { prisma, socket, service } = makeService();

    await service.confirmPayment('payment-1', 'cashier-1');

    expect(prisma.cashClosing.findFirst).toHaveBeenCalledWith({
      where: {
        isOpen: true,
        cashRegister: { purpose: 'DELIVERY', active: true },
      },
      orderBy: { shiftStart: 'desc' },
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        paymentStatus: 'CONFIRMED',
        cashRegisterId: 'delivery-register',
        cashClosingId: 'delivery-closing',
      },
    });
    expect(socket.server.emit).toHaveBeenCalledWith('cashRegistersChanged');
  });

  it('does not allow a delivery payment to be confirmed without an open delivery cash register', async () => {
    const { prisma, service } = makeService({
      cashClosing: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    });

    await expect(service.confirmPayment('payment-1', 'cashier-1')).rejects.toThrow('La Caja Domicilios está cerrada');
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('keeps a credit settlement for delivery in Caja Domicilios', async () => {
    const { prisma, service } = makeService({
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderType: 'DELIVERY',
          paymentMethod: 'CREDIT',
          cashClosingId: null,
          customerId: null,
          customerPhone: null,
          total: 18_000,
          payment: { id: 'payment-1' },
        }),
        update: jest.fn().mockResolvedValue({ id: 'order-1', customerPhone: null }),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-closing', cashRegisterId: 'delivery-register' }),
        findUnique: jest.fn(),
      },
    });

    await service.payCreditOrder('order-1', { method: 'TRANSFER', reference: 'TRX-1' }, 'cashier-1');

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        paymentStatus: 'CONFIRMED',
        cashRegisterId: 'delivery-register',
        cashClosingId: 'delivery-closing',
      },
    });
  });

  it('keeps a cash-closing detail read-only', async () => {
    const shiftStart = new Date('2026-09-08T15:00:00.000Z');
    const { prisma, service } = makeService({
      cashClosing: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: 'delivery-closing',
          isOpen: false,
          shiftStart,
          shiftEnd: new Date('2026-09-08T20:00:00.000Z'),
          initialCash: 0,
          totalCash: 0,
          totalTransfers: 0,
          totalNequi: 0,
          totalBancolombia: 0,
          totalDaviplata: 0,
          totalSales: 0,
          totalTips: 0,
          totalExpenses: 0,
          discrepancy: 0,
          notes: null,
          userId: 'dispatcher-1',
          cashRegisterId: 'delivery-register',
          user: { id: 'dispatcher-1', name: 'Ana' },
          cashRegister: { id: 'delivery-register', name: 'Caja Domicilios', purpose: 'DELIVERY' },
        }),
      },
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
    });

    await service.getClosingDetail('delivery-closing');

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        cashClosingId: 'delivery-closing',
        cashRegisterId: 'delivery-register',
        orderType: { in: ['DELIVERY', 'PICKUP'] },
      }),
    }));
  });
});
