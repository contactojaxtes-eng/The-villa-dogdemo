import { OrdersService } from './orders.service';

describe('Delivery order boundaries', () => {
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
