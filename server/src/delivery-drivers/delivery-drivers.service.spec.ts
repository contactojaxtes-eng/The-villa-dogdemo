import { DeliveryDriversService } from './delivery-drivers.service';

describe('DeliveryDriversService cash settlements', () => {
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
});
