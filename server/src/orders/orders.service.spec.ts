import { OrdersService } from './orders.service';

describe('Delivery order boundaries', () => {
  it('replays a client mutation without creating or notifying a duplicate order', async () => {
    const existingOrder = {
      id: 'order-1',
      waiterId: 'advisor-1',
      customerPhone: '3001234567',
      clientMutationId: 'mutation-1',
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      order: { findUnique: jest.fn().mockResolvedValue(existingOrder) },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    const socket: any = { emitNewOrder: jest.fn(), server: { emit: jest.fn() } };
    const service = new OrdersService(prisma, socket, {} as any, {} as any);

    const result = await service.create({
      waiterId: 'advisor-1',
      customerPhone: '3001234567',
      clientMutationId: 'mutation-1',
    });

    expect(result).toEqual({ ...existingOrder, idempotentReplay: true });
    expect(socket.emitNewOrder).not.toHaveBeenCalled();
    expect(socket.server.emit).not.toHaveBeenCalled();
  });

  it('filters the delivery history at the database query', async () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await service.findAll({ orderType: 'DELIVERY,PICKUP' });

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderType: { in: ['DELIVERY', 'PICKUP'] } },
    }));
  });

  it('looks up a WhatsApp order only by its exact chat session', async () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await service.findAll({ chatSessionId: 'chat-107', orderType: 'DELIVERY,PICKUP', compact: true });

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ chatSessionId: 'chat-107' }),
    }));
  });

  it('honors compact lookup limits without returning stored media blobs', async () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await service.findAll({ search: '3001234567', orderType: 'DELIVERY,PICKUP', compact: true, limit: 5 });

    const query = prisma.order.findMany.mock.calls[0][0];
    expect(query.take).toBe(5);
    expect(query.include.items.select.menuItem.select).toEqual({ id: true, name: true, price: true });
    expect(query.include.payment.select.proofImage).toBeUndefined();
  });

  it('paginates delivery history and only bills confirmed delivered orders', async () => {
    const prisma: any = {
      order: {
        findMany: jest.fn().mockResolvedValue([{ id: 'delivery-21' }]),
        count: jest.fn()
          .mockResolvedValueOnce(21)
          .mockResolvedValueOnce(41),
        groupBy: jest.fn().mockResolvedValue([
          { status: 'PENDING', _count: { _all: 3 } },
          { status: 'DELIVERED', _count: { _all: 17 } },
          { status: 'CANCELLED', _count: { _all: 1 } },
        ]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 238000 } }),
      },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    const result = await service.findDeliveryHistory({
      orderType: 'DELIVERY,PICKUP',
      status: 'DELIVERED',
      page: 2,
      limit: 20,
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderType: { in: ['DELIVERY', 'PICKUP'] }, status: 'DELIVERED' },
      skip: 20,
      take: 20,
    }));
    expect(prisma.order.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderType: { in: ['DELIVERY', 'PICKUP'] }, status: 'DELIVERED', paymentStatus: 'CONFIRMED' },
    }));
    expect(result).toMatchObject({
      pagination: { page: 2, total: 21, totalPages: 2 },
      summary: { total: 41, listed: 21, active: 3, delivered: 17, cancelled: 1, billed: 238000 },
    });
  });

  it('keeps local table orders out of the active delivery queue', async () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await service.getActiveOrders();

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tableId: null,
        orderType: { in: ['DELIVERY', 'PICKUP'] },
      }),
    }));
    const query = prisma.order.findMany.mock.calls[0][0];
    expect(query.include.items.select.menuItem.select).toEqual({ id: true, name: true, price: true });
  });

  it('refuses to liquidate a delivery that is still in the kitchen', async () => {
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'closing-1' }) },
      order: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'order-kitchen',
          orderNumber: 308,
          status: 'PENDING',
          orderType: 'DELIVERY',
          total: 20500,
          paymentMethod: 'CASH',
          cashAmount: 20500,
          transferAmount: 0,
          paymentReference: null,
          deliveryDriverId: 'driver-1',
        }]),
      },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await expect(service.batchCollectPayments(
      [{ id: 'order-kitchen', method: 'CASH' }],
      'AS_IS',
      undefined,
      { id: 'admin-1', role: 'ADMIN' },
    )).rejects.toThrow('Solo se pueden liquidar domicilios en ruta');
  });

  it('refuses to liquidate a delivery marked ready before it goes in route', async () => {
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'closing-1' }) },
      order: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'delivery-ready', orderNumber: 312, status: 'READY', orderType: 'DELIVERY', total: 22000,
          paymentMethod: 'CASH', cashAmount: 22000, transferAmount: 0, paymentReference: null, deliveryDriverId: 'driver-1',
        }]),
      },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await expect(service.batchCollectPayments(
      [{ id: 'delivery-ready', method: 'CASH' }],
      'AS_IS',
      undefined,
      { id: 'admin-1', role: 'ADMIN' },
    )).rejects.toThrow('Solo se pueden liquidar domicilios en ruta');
  });

  it('charges several ready pickup orders in one batch', async () => {
    const pickupOrders = [
      {
        id: 'pickup-1', orderNumber: 313, status: 'READY', orderType: 'PICKUP', total: 14000,
        paymentMethod: 'CASH', cashAmount: 14000, transferAmount: 0, paymentReference: null, deliveryDriverId: null,
      },
      {
        id: 'pickup-2', orderNumber: 314, status: 'READY', orderType: 'PICKUP', total: 18000,
        paymentMethod: 'CASH', cashAmount: 18000, transferAmount: 0, paymentReference: null, deliveryDriverId: null,
      },
    ];
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'closing-1' }) },
      order: { findMany: jest.fn().mockResolvedValue(pickupOrders) },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'updatePayment').mockImplementation(async (id: string) => ({ id }) as any);

    const result = await service.batchCollectPayments(
      pickupOrders.map(order => ({ id: order.id, method: 'CASH' })),
      'AS_IS',
      undefined,
      { id: 'admin-1', role: 'ADMIN' },
    );

    expect(service.updatePayment).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ collectedCount: 2, cash: 32000, transfer: 0, total: 32000 });
  });

  it('refuses an individual confirmed payment while a delivery is still in the kitchen', async () => {
    const prisma: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-kitchen',
          orderNumber: 308,
          status: 'PENDING',
          orderType: 'DELIVERY',
          paymentMethod: 'CASH',
        }),
      },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await expect(service.updatePayment(
      'order-kitchen',
      'CASH',
      'CONFIRMED',
      undefined,
      { id: 'admin-1', role: 'ADMIN' },
    )).rejects.toThrow('El domicilio debe estar en ruta antes de liquidarlo');
  });

  it('requires transfer review before batch liquidation', async () => {
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'closing-1' }) },
      order: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'transfer-order', orderNumber: 310, status: 'IN_ROUTE', orderType: 'DELIVERY', total: 19500,
          paymentMethod: 'TRANSFER', cashAmount: 0, transferAmount: 19500, paymentReference: null, deliveryDriverId: 'driver-1',
        }]),
      },
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);

    await expect(service.batchCollectPayments(
      [{ id: 'transfer-order', method: 'TRANSFER' }],
      'AS_IS',
      undefined,
      { id: 'admin-1', role: 'ADMIN' },
    )).rejects.toThrow('Debes validar el chat o comprobante de transferencia');
  });

  it('liquidates an in-route batch with its per-order payment methods', async () => {
    const orders = [
      {
        id: 'cash-order', orderNumber: 309, status: 'IN_ROUTE', orderType: 'DELIVERY', total: 21000,
        paymentMethod: 'CASH', cashAmount: 21000, transferAmount: 0, paymentReference: null, deliveryDriverId: 'driver-1',
      },
      {
        id: 'transfer-order', orderNumber: 310, status: 'IN_ROUTE', orderType: 'DELIVERY', total: 19500,
        paymentMethod: 'TRANSFER', cashAmount: 0, transferAmount: 19500, paymentReference: 'chat-validado', deliveryDriverId: 'driver-1',
      },
    ];
    const tx: any = {
      driverSettlement: { create: jest.fn().mockResolvedValue({ id: 'settlement-1' }) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'closing-1' }) },
      order: { findMany: jest.fn().mockResolvedValue(orders) },
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'updatePayment').mockImplementation(async (id: string) => ({ id }) as any);

    const result = await service.batchCollectPayments(
      [
        { id: 'cash-order', method: 'CASH' },
        { id: 'transfer-order', method: 'TRANSFER', reference: 'chat-validado', transferReviewed: true },
      ],
      'AS_IS',
      undefined,
      { id: 'admin-1', role: 'ADMIN' },
    );

    expect(service.updatePayment).toHaveBeenNthCalledWith(
      1, 'cash-order', 'CASH', 'CONFIRMED', undefined, expect.anything(), undefined, undefined, 21000, 0,
    );
    expect(service.updatePayment).toHaveBeenNthCalledWith(
      2, 'transfer-order', 'TRANSFER', 'CONFIRMED', 'chat-validado', expect.anything(), undefined, undefined, 0, 19500,
    );
    expect(tx.driverSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        driverId: 'driver-1',
        cashClosingId: 'closing-1',
        receivedById: 'admin-1',
        expectedCash: 21000,
        receivedCash: 21000,
      }),
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['cash-order'] }, driverSettlementId: null }),
      data: { driverSettlementId: 'settlement-1' },
    }));
    expect(result).toMatchObject({ collectedCount: 2, failedCount: 0, cash: 21000, transfer: 19500, total: 40500 });
  });

  it('records only the cash portion as settled for a mixed delivery', async () => {
    const order = {
      id: 'mixed-order', orderNumber: 315, status: 'IN_ROUTE', orderType: 'DELIVERY', total: 30000,
      paymentMethod: 'MIXED', cashAmount: 12000, transferAmount: 18000,
      paymentReference: 'chat-validado', deliveryDriverId: 'driver-1',
    };
    const tx: any = {
      driverSettlement: { create: jest.fn().mockResolvedValue({ id: 'settlement-mixed' }) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'closing-1' }) },
      order: { findMany: jest.fn().mockResolvedValue([order]) },
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    const service = new OrdersService(prisma, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'updatePayment').mockResolvedValue({ id: order.id } as any);

    const result = await service.batchCollectPayments(
      [{ id: order.id, method: 'MIXED', cashAmount: 12000, transferAmount: 18000, transferReviewed: true }],
      'AS_IS',
      undefined,
      { id: 'admin-1', role: 'ADMIN' },
    );

    expect(tx.driverSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expectedCash: 12000, receivedCash: 12000, difference: 0 }),
    });
    expect(result).toMatchObject({ cash: 12000, transfer: 18000, total: 30000 });
  });
});
