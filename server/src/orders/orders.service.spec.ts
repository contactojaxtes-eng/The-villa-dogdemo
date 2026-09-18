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

  it('releases the WhatsApp chat when delivery is completed silently', async () => {
    const order = {
      id: 'order-delivered',
      orderNumber: 311,
      status: 'IN_ROUTE',
      orderType: 'DELIVERY',
      customerName: 'Cliente WhatsApp',
      customerPhone: '3001234567',
      chatSessionId: 'chat-311',
      deliveryDriverId: 'driver-1',
      paymentMethod: 'TRANSFER',
      paymentStatus: 'PENDING_REVIEW',
    };
    const updated = { ...order, status: 'DELIVERED' };
    const prisma: any = {
      order: {
        update: jest.fn()
          .mockResolvedValueOnce(updated)
          .mockResolvedValueOnce(updated),
      },
    };
    const socket: any = {
      emitOrderStatusChange: jest.fn(),
      emitWhatsApp: jest.fn(),
    };
    const whatsapp: any = { unassignSessionByPhone: jest.fn().mockResolvedValue(undefined) };
    const service = new OrdersService(prisma, socket, whatsapp, {} as any);
    jest.spyOn(service, 'findOne').mockResolvedValue(order as any);

    await service.updateStatus('order-delivered', 'DELIVERED', { id: 'admin-1', role: 'ADMIN' }, undefined, false);

    expect(whatsapp.unassignSessionByPhone).toHaveBeenCalledWith('3001234567');
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
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'closing-1' }) },
      order: { findMany: jest.fn().mockResolvedValue(orders) },
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
    expect(result).toMatchObject({ collectedCount: 2, failedCount: 0, cash: 21000, transfer: 19500, total: 40500 });
  });
});
