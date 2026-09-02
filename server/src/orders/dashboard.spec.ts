import { OrdersService } from './orders.service';

describe('Operational dashboard contract', () => {
  it('returns the UI contract, confirmed sales and independent current queues', async () => {
    const db: any = {
      order: { groupBy: jest.fn().mockResolvedValue([{ status: 'PENDING', _count: { _all: 2 } }, { status: 'DELIVERED', _count: { _all: 3 } }, { status: 'CANCELLED', _count: { _all: 1 } }]), aggregate: jest.fn().mockResolvedValue({ _sum: { total: 12000 } }), count: jest.fn().mockResolvedValue(4) },
      diningTable: { count: jest.fn().mockResolvedValue(2) }, kitchenTicket: { count: jest.fn().mockResolvedValue(5) }, payment: { count: jest.fn().mockResolvedValue(1) }, cashClosing: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = new OrdersService(db, {} as any, {} as any, {} as any);
    const result = await service.getDashboardStats('2026-09-01', '2026-09-02');
    expect(result.today).toEqual({ orders: 6, delivered: 3, cancelled: 1, pending: 2, sales: 12000 });
    expect(result.operation).toEqual({ openTables: 2, kitchenPending: 5, pendingPayments: 1, activeDeliveries: 4, openRegisters: 1 });
    expect(db.order.aggregate.mock.calls[0][0].where).toMatchObject({ status: 'DELIVERED', paymentStatus: 'CONFIRMED' });
    expect(db.kitchenTicket.count.mock.calls[0][0].where.status.in).toEqual(['NEW', 'PREPARING']);
    expect(db.payment.count.mock.calls[0][0].where.status.in).toContain('PENDING_REVIEW');
  });
});
