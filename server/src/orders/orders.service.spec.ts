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
