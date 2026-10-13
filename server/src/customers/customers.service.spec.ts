import { BadRequestException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService multisite finances', () => {
  const siteId = 'site-2';
  let prisma: any;
  let socket: any;
  let service: CustomersService;

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      cashClosing: { findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
      customerPayment: { create: jest.fn() },
    };
    socket = { emitToSite: jest.fn() };
    service = new CustomersService(prisma, socket);
  });

  it('calculates customer debt using only orders and payments from the active site', async () => {
    prisma.customer.findMany.mockResolvedValue([]);

    await service.findAll('Ana', siteId);

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          orders: {
            where: { siteId, paymentMethod: 'CREDIT' },
            select: { total: true },
          },
          payments: {
            where: { siteId },
            select: { amount: true },
          },
        },
      }),
    );
  });

  it('records a payment only in the active site and its open cash register', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1', siteId });
    prisma.cashClosing.findFirst.mockResolvedValue({ cashRegisterId: 'register-2' });
    prisma.user.findUnique.mockResolvedValue({ role: 'CASHIER' });
    prisma.customerPayment.create.mockResolvedValue({ id: 'payment-1', siteId });

    const result = await service.addPayment(
      'customer-1',
      { amount: 25000, method: 'CASH' },
      'cashier-1',
      siteId,
    );

    expect(prisma.cashClosing.findFirst).toHaveBeenCalledWith({
      where: { siteId, userId: 'cashier-1', isOpen: true },
    });
    expect(prisma.customerPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId,
        customerId: 'customer-1',
        cashRegisterId: 'register-2',
      }),
    });
    expect(socket.emitToSite).toHaveBeenCalledWith(siteId, 'customersChanged');
    expect(result.siteId).toBe(siteId);
  });

  it('does not let a cashier use an open register from another site', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1', siteId });
    prisma.cashClosing.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ role: 'CASHIER' });

    await expect(
      service.addPayment(
        'customer-1',
        { amount: 10000, method: 'CASH' },
        'cashier-1',
        siteId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customerPayment.create).not.toHaveBeenCalled();
  });
});
