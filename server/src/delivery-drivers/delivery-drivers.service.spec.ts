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
          { id: 'cash-order', total: 25_000, cashAmount: null, paymentMethod: 'CASH', paymentStatus: 'DRIVER_CASH_PENDING' },
          { id: 'mixed-order', total: 30_000, cashAmount: 10_000, paymentMethod: 'MIXED', paymentStatus: 'PENDING_REVIEW' },
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
    expect(tx.order.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ['cash-order', 'mixed-order'] }, driverSettlementId: null },
      data: { driverSettlementId: 'settlement-1' },
    });
    expect(tx.order.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['cash-order'] }, driverSettlementId: 'settlement-1' },
      data: { paymentStatus: 'CONFIRMED' },
    });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: { in: ['cash-order'] } },
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

  it('keeps a mixed order pending for cash even after its transfer was confirmed', async () => {
    const prisma: any = {
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'delivery-shift',
          cashRegisterId: 'delivery-register',
          shiftStart: new Date('2026-09-21T12:00:00Z'),
        }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'mixed-order',
          orderNumber: 77,
          total: 30_000,
          cashAmount: 12_000,
          paymentMethod: 'MIXED',
          paymentStatus: 'CONFIRMED',
          driverSettlementId: null,
          deliveryDriver: { id: 'driver-1', name: 'Carlos', phone: '3000000000' },
        }]),
      },
    };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    const result = await service.getPendingSettlements();

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ paymentStatus: expect.anything() }),
    }));
    expect(result.totalPendingCash).toBe(12_000);
    expect(result.drivers[0].orders).toEqual([{ id: 'mixed-order', orderNumber: 77, amount: 12_000 }]);
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
    expect(socket.emitPaymentSubmitted).not.toHaveBeenCalled();
  });

  it('records the exact cash and transfer portions of a mixed driver payment', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      deliveryDriver: {
        findUnique: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mixed-order',
          orderNumber: 42,
          total: 30_000,
          orderType: 'DELIVERY',
          status: 'IN_ROUTE',
          paymentMethod: 'CASH',
          paymentStatus: 'PENDING',
          cashAmount: 30_000,
          transferAmount: 0,
        }),
        update: jest.fn().mockResolvedValue({ id: 'mixed-order' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'mixed-order', status: 'DELIVERED' }),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-shift', cashRegisterId: 'delivery-register' }),
      },
      payment: {
        upsert: jest.fn().mockResolvedValue({ id: 'payment-2', status: 'PENDING_REVIEW' }),
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

    await service.completeMyOrder('driver-user', 'mixed-order', {
      method: 'MIXED',
      cashAmount: 12_000,
      transferAmount: 18_000,
    }, []);

    expect(tx.payment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        method: 'MIXED',
        cashAmount: 12_000,
        transferAmount: 18_000,
        status: 'PENDING_REVIEW',
      }),
    }));
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paymentMethod: 'MIXED',
        cashAmount: 12_000,
        transferAmount: 18_000,
        status: 'DELIVERED',
      }),
    }));
    expect(tx.transferProof.create).not.toHaveBeenCalled();
    expect(socket.emitPaymentSubmitted).not.toHaveBeenCalled();
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

  it('rejects a driver login that matches another user after normalization', async () => {
    const prisma: any = {
      deliveryDriver: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'driver-1',
          name: 'Juan Padilla',
          phone: '3001234567',
          active: true,
          userId: null,
          user: null,
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'cook-1', name: 'Cocinero Principal', email: 'juan-p@otraempresa.com', role: 'KITCHEN' },
        ]),
        create: jest.fn(),
      },
    };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    await expect(service.configureAccess('driver-1', {
      mode: 'CREATE',
      login: 'Juán P',
      password: '1234',
    })).rejects.toThrow('Ya existe un usuario con ese nombre o acceso');

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a new driver access when the normalized display name belongs to another user', async () => {
    const prisma: any = {
      deliveryDriver: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'driver-1',
          name: 'Juán Padilla',
          phone: '3001234567',
          active: true,
          userId: null,
          user: null,
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'admin-1', name: 'Juan-Padilla', email: 'administracion@thevilladog.local', role: 'ADMIN' },
        ]),
        create: jest.fn(),
      },
    };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    await expect(service.configureAccess('driver-1', {
      mode: 'CREATE',
      login: 'repartidor.21',
      password: '1234',
    })).rejects.toThrow('Ya existe un usuario con ese nombre o acceso');

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('never converts an account from another operational role when resetting driver access', async () => {
    const prisma: any = {
      deliveryDriver: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'driver-1',
          name: 'Juan Padilla',
          phone: '3001234567',
          active: true,
          userId: 'operational-user',
          user: { id: 'operational-user' },
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'operational-user', role: 'KITCHEN' }),
        update: jest.fn(),
      },
    };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    await expect(service.configureAccess('driver-1', {
      mode: 'CREATE',
      login: 'juan.padilla',
      password: '1234',
    })).rejects.toThrow('pertenece a otro perfil de trabajo');

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects linking a driver account when the driver name would duplicate another user', async () => {
    const prisma: any = {
      deliveryDriver: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'driver-1',
          name: 'Juan Padilla',
          phone: '3001234567',
          active: true,
          userId: null,
          user: null,
        }),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'driver-account',
          name: 'Repartidor 21',
          email: 'repartidor.21@thevilladog.local',
          role: 'DELIVERY_DRIVER',
          active: true,
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'driver-account', name: 'Repartidor 21', email: 'repartidor.21@thevilladog.local', role: 'DELIVERY_DRIVER' },
          { id: 'cook-1', name: 'Juán-Padilla', email: 'cocina.1@thevilladog.local', role: 'KITCHEN' },
        ]),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    await expect(service.configureAccess('driver-1', {
      mode: 'LINK',
      userId: 'driver-account',
    })).rejects.toThrow('Ya existe un usuario con ese nombre o acceso');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
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

  it('does not let a replacement proof change mixed amounts after cash was settled', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      deliveryDriver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }) },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mixed-order',
          total: 30_000,
          orderType: 'DELIVERY',
          status: 'DELIVERED',
          paymentMethod: 'MIXED',
          paymentStatus: 'PENDING_REVIEW',
          cashAmount: 12_000,
          transferAmount: 18_000,
          cashClosingId: 'delivery-shift',
          driverSettlementId: 'settlement-1',
        }),
      },
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'delivery-shift', cashRegisterId: 'delivery-register' }) },
      payment: { upsert: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)) };
    const service = new DeliveryDriversService(prisma, { server: { emit: jest.fn() } } as any);

    await expect(service.uploadMyProof('driver-user', 'mixed-order', {
      method: 'MIXED',
      cashAmount: 10_000,
      transferAmount: 20_000,
    }, [{
      fieldname: 'proof',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimetype: 'image/jpeg',
    }])).rejects.toThrow('El efectivo ya fue liquidado');
    expect(tx.payment.upsert).not.toHaveBeenCalled();
  });

  it('lets the driver correct an unliquidated payment and preserves the original method', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      deliveryDriver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }) },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          total: 22_000,
          status: 'DELIVERED',
          orderType: 'DELIVERY',
          paymentMethod: 'TRANSFER',
          originalPaymentMethod: 'CASH',
          paymentStatus: 'PENDING_REVIEW',
          cashClosingId: 'delivery-shift',
          driverSettlementId: null,
          paymentReference: 'referencia anterior',
        }),
        update: jest.fn().mockResolvedValue({ id: 'order-1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          deliveryDriverId: 'driver-1',
          paymentMethod: 'CASH',
          originalPaymentMethod: 'CASH',
        }),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({ id: 'delivery-shift', cashRegisterId: 'delivery-register' }),
      },
      payment: { upsert: jest.fn().mockResolvedValue({ id: 'payment-1', method: 'CASH' }) },
      transferProof: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      orderChangeLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    const socket: any = { server: { emit: jest.fn() } };
    const service = new DeliveryDriversService(prisma, socket);

    await service.updateMyPayment('driver-user', 'order-1', { method: 'CASH' });

    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        originalPaymentMethod: 'CASH',
        paymentMethod: 'CASH',
        paymentStatus: 'DRIVER_CASH_PENDING',
        cashAmount: 22_000,
        transferAmount: 0,
      }),
    }));
    expect(tx.transferProof.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUPERSEDED', fileBase64: null }),
    }));
    expect(socket.server.emit).toHaveBeenCalledWith('orderUpdated', expect.objectContaining({ id: 'order-1' }));
  });

  it('rejects a file that only claims to be an image', async () => {
    await expect(validateReceipt({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      mimetype: 'image/svg+xml',
    })).rejects.toThrow('imagen válida');
  });
});
