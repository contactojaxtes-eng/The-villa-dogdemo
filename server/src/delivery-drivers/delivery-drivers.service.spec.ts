import { DeliveryDriversService } from './delivery-drivers.service';
import { validateReceipt } from '../tables/receipt';

describe('DeliveryDriversService', () => {
  it('settles delivered cash orders in the active delivery shift', async () => {
    const tx: any = {
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-shift' }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'cash-order', total: 25_000, cashAmount: null, paymentMethod: 'CASH' },
          { id: 'mixed-order', total: 30_000, cashAmount: 10_000, paymentMethod: 'MIXED' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      driverSettlement: {
        create: jest.fn().mockResolvedValue({ id: 'settlement-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'settlement-1', expectedCash: 35_000, receivedCash: 34_000 }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    const socket: any = { server: { emit: jest.fn() } };
    const service = new DeliveryDriversService(prisma, socket);

    const result = await service.settleCash(
      'driver-1',
      { orderIds: ['cash-order', 'mixed-order', 'cash-order'], receivedCash: 34_000, notes: 'Faltó mil' },
      'cashier-1',
    );

    expect(tx.driverSettlement.create).toHaveBeenCalledWith({
      data: {
        driverId: 'driver-1',
        cashClosingId: 'delivery-shift',
        receivedById: 'cashier-1',
        expectedCash: 35_000,
        receivedCash: 34_000,
        difference: -1_000,
        notes: 'Faltó mil',
      },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['cash-order', 'mixed-order'] }, driverSettlementId: null },
      data: { driverSettlementId: 'settlement-1', paymentStatus: 'CONFIRMED' },
    });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: { in: ['cash-order', 'mixed-order'] } },
      data: {
        status: 'CONFIRMED',
        confirmedAt: expect.any(Date),
        confirmedBy: 'cashier-1',
      },
    });
    expect(socket.server.emit).toHaveBeenCalledWith('driverSettlementCreated', result);
    expect(socket.server.emit).toHaveBeenCalledWith('driversChanged');
    expect(socket.server.emit).toHaveBeenCalledWith('cashRegistersChanged');
  });

  it('allows a driver to close only their own transfer delivery without a proof photo', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      deliveryDriver: {
        findUnique: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderNumber: 41,
          total: 25_000,
          orderType: 'DELIVERY',
          status: 'IN_ROUTE',
          paymentMethod: 'CASH',
          paymentStatus: 'PENDING',
        }),
        update: jest.fn().mockResolvedValue({ id: 'order-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', status: 'DELIVERED' }),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-shift', cashRegisterId: 'delivery-register' }),
      },
      payment: {
        upsert: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'PENDING_REVIEW' }),
      },
      transferProof: { create: jest.fn() },
      orderChangeLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    const socket: any = {
      server: { emit: jest.fn() },
      emitOrderStatusChange: jest.fn(),
      emitPaymentSubmitted: jest.fn(),
    };
    const service = new DeliveryDriversService(prisma, socket);

    await service.completeMyOrder('driver-user', 'order-1', { method: 'TRANSFER' }, []);

    expect(tx.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1', deliveryDriverId: 'driver-1', orderType: 'DELIVERY' },
    }));
    expect(tx.payment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        orderId: 'order-1',
        method: 'TRANSFER',
        cashAmount: 0,
        transferAmount: 25_000,
        status: 'PENDING_REVIEW',
      }),
    }));
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DELIVERED',
        paymentStatus: 'PENDING_REVIEW',
        cashClosingId: 'delivery-shift',
      }),
    }));
    expect(tx.transferProof.create).not.toHaveBeenCalled();
    expect(socket.emitPaymentSubmitted).toHaveBeenCalled();
  });

  it('never offers an operational account when configuring a driver portal', async () => {
    const prisma: any = {
      deliveryDriver: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    await service.getAccessCandidates();

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: 'DELIVERY_DRIVER', active: true }),
    }));
  });

  it('does not move a delivered order from a prior cash shift when a driver adds a proof', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      deliveryDriver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }) },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'old-order',
          total: 18_000,
          orderType: 'DELIVERY',
          status: 'DELIVERED',
          paymentMethod: 'TRANSFER',
          paymentStatus: 'PENDING_REVIEW',
          cashClosingId: 'previous-delivery-shift',
        }),
      },
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'current-delivery-shift', cashRegisterId: 'delivery-register' }) },
      payment: { upsert: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)) };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    await expect(service.uploadMyProof('driver-user', 'old-order', { method: 'TRANSFER' }, [{
      fieldname: 'proof',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimetype: 'image/jpeg',
    }])).rejects.toThrow('turno actual');
    expect(tx.payment.upsert).not.toHaveBeenCalled();
  });

  it('rejects a file that only claims to be an image', async () => {
    await expect(validateReceipt({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      mimetype: 'image/svg+xml',
    })).rejects.toThrow('imagen válida');
  });
});
