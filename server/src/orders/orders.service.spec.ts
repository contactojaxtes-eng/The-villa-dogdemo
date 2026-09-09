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
});
