import { DeliveryDriversService } from './delivery-drivers.service';
import { validateReceipt } from '../tables/receipt';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

const SECOND_SITE_ID = '00000000-0000-4000-8000-000000000202';

const makeSocketGateway = () => ({
  emitToSite: jest.fn(),
  emitOrderStatusChange: jest.fn(),
});

describe('DeliveryDriversService', () => {
  it('lists drivers without running the duplicate merge maintenance task', async () => {
    const prisma: any = {
      deliveryDriver: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);
    const mergeSpy = jest.spyOn(service, 'autoMergeDuplicates').mockResolvedValue();

    await expect(service.findAll(false, 'ALL', undefined, undefined, false, SECOND_SITE_ID)).resolves.toEqual([]);

    expect(mergeSpy).not.toHaveBeenCalled();
    expect(prisma.deliveryDriver.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.deliveryDriver.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { siteId: SECOND_SITE_ID },
      include: expect.objectContaining({
        orders: expect.objectContaining({ where: { siteId: SECOND_SITE_ID } }),
      }),
    }));
  });

  it('returns one lightweight portal snapshot and never exposes an order owned by another driver', async () => {
    const prisma: any = {
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
      },
      cashClosing: {
        findFirst: jest.fn().mockResolvedValue({ id: 'shift-1' }),
      },
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'order-1',
            status: 'DELIVERED',
            cashClosingId: 'shift-1',
            transferProofs: [],
            items: [],
          })
          .mockResolvedValueOnce(null),
      },
    };
    const service = new DeliveryDriversService(prisma, {} as any);

    await expect(service.getMyOrderSnapshot('driver-user-1', 'order-1')).resolves.toEqual({
      orderId: 'order-1',
      bucket: 'HISTORY',
      order: expect.objectContaining({ id: 'order-1' }),
    });
    await expect(service.getMyOrderSnapshot('driver-user-1', 'foreign-order')).resolves.toEqual({
      orderId: 'foreign-order',
      bucket: 'NONE',
      order: null,
    });
    expect(prisma.order.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: 'foreign-order',
        siteId: DEFAULT_SITE_ID,
        deliveryDriverId: 'driver-1',
        orderType: 'DELIVERY',
      },
    }));
    expect(prisma.cashClosing.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns only messages linked to the driver own order and hides Meta media IDs', async () => {
    const prisma: any = {
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderNumber: 501,
          customerName: 'Cliente',
          status: 'IN_ROUTE',
          paymentMethod: 'TRANSFER',
          paymentStatus: 'PENDING',
          createdAt: new Date('2026-09-27T16:00:00.000Z'),
          updatedAt: new Date('2026-09-27T16:10:00.000Z'),
          chatSessionId: 'session-1',
          transferProofs: [],
        }),
      },
      whatsAppMessage: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'message-1',
          direction: 'IN',
          content: '/api/whatsapp/media/private-meta-id|Te envié el comprobante',
          messageType: 'image',
          status: 'received',
          createdAt: new Date('2026-09-27T16:05:00.000Z'),
          replyToContent: '/api/whatsapp/media/quoted-private-meta-id',
          replyToDirection: null,
        }]),
      },
    };
    const whatsapp: any = { ensureLegacyOrderMessageLinks: jest.fn().mockResolvedValue(undefined) };
    const service = new DeliveryDriversService(prisma, {} as any, undefined, whatsapp);

    const result: any = await service.getMyOrderChat('driver-user-1', 'order-1');

    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'order-1',
        deliveryDriverId: 'driver-1',
        orderType: 'DELIVERY',
      }),
    }));
    expect(prisma.whatsAppMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderId: 'order-1', sessionId: 'session-1' }),
      take: 21,
    }));
    expect(result.messages).toEqual([expect.objectContaining({
      id: 'message-1',
      content: 'Te envié el comprobante',
      replyToContent: 'Archivo multimedia',
      hasMedia: true,
    })]);
    expect(JSON.stringify(result)).not.toContain('private-meta-id');
  });

  it('never reveals whether an order assigned to another driver exists', async () => {
    const prisma: any = {
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
      },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      whatsAppMessage: { findMany: jest.fn() },
    };
    const service = new DeliveryDriversService(prisma, {} as any);

    await expect(service.getMyOrderChat('driver-user-1', 'order-for-driver-2'))
      .rejects.toThrow('No puedes consultar este pedido.');
    expect(prisma.whatsAppMessage.findMany).not.toHaveBeenCalled();
  });

  it('loads media only after validating both the order and the exact linked message', async () => {
    const media = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg' };
    const prisma: any = {
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({ id: 'order-1', chatSessionId: 'session-1' }),
      },
      whatsAppMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message-1',
          messageType: 'image',
          content: '/api/whatsapp/media/media-1|Comprobante',
        }),
      },
    };
    const whatsapp: any = { getMediaBuffer: jest.fn().mockResolvedValue(media) };
    const service = new DeliveryDriversService(prisma, {} as any, undefined, whatsapp);

    await expect(service.getMyOrderChatMedia('driver-user-1', 'order-1', 'message-1'))
      .resolves.toEqual(media);
    expect(prisma.whatsAppMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'message-1', orderId: 'order-1', sessionId: 'session-1' },
      select: { id: true, messageType: true, content: true },
    });
    expect(whatsapp.getMediaBuffer).toHaveBeenCalledWith('media-1', DEFAULT_SITE_ID);
  });

  it('uses the active site when loading Meta media for a secondary-site driver chat', async () => {
    const prisma: any = {
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-2', active: true }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({ id: 'order-2', chatSessionId: 'session-2' }),
      },
      whatsAppMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message-2',
          messageType: 'image',
          content: '/api/whatsapp/media/media-2|Comprobante',
        }),
      },
    };
    const whatsapp: any = {
      getMediaBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    };
    const service = new DeliveryDriversService(prisma, {} as any, undefined, whatsapp);

    await service.getMyOrderChatMedia('driver-user-2', 'order-2', 'message-2', SECOND_SITE_ID);

    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ siteId: SECOND_SITE_ID }),
    }));
    expect(whatsapp.getMediaBuffer).toHaveBeenCalledWith('media-2', SECOND_SITE_ID);
  });

  it('settles delivered cash orders in the active delivery shift', async () => {
    const tx: any = {
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
      },
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
    const socket: any = makeSocketGateway();
    const service = new DeliveryDriversService(prisma, socket);

    const result = await service.settleCash(
      'driver-1',
      { orderIds: ['cash-order', 'mixed-order', 'cash-order'], receivedCash: 34_000, notes: 'Faltó mil' },
      'cashier-1',
    );

    expect(tx.driverSettlement.create).toHaveBeenCalledWith({
      data: {
        driverId: 'driver-1',
        siteId: DEFAULT_SITE_ID,
        cashClosingId: 'delivery-shift',
        receivedById: 'cashier-1',
        expectedCash: 35_000,
        receivedCash: 34_000,
        difference: -1_000,
        notes: 'Faltó mil',
      },
    });
    expect(tx.order.updateMany).toHaveBeenNthCalledWith(1, {
      where: { siteId: DEFAULT_SITE_ID, id: { in: ['cash-order', 'mixed-order'] }, driverSettlementId: null },
      data: { driverSettlementId: 'settlement-1' },
    });
    expect(tx.order.updateMany).toHaveBeenNthCalledWith(2, {
      where: { siteId: DEFAULT_SITE_ID, id: { in: ['cash-order'] }, driverSettlementId: 'settlement-1' },
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
    expect(socket.emitToSite).toHaveBeenCalledWith(DEFAULT_SITE_ID, 'driverSettlementCreated', result);
    expect(socket.emitToSite).toHaveBeenCalledWith(DEFAULT_SITE_ID, 'driversChanged');
    expect(socket.emitToSite).toHaveBeenCalledWith(DEFAULT_SITE_ID, 'cashRegistersChanged');
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
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

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
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
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
      emitOrderStatusChange: jest.fn(),
      emitToSite: jest.fn(),
    };
    const service = new DeliveryDriversService(prisma, socket);

    await service.completeMyOrder('driver-user', 'order-1', { method: 'TRANSFER' }, []);

    expect(tx.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1', siteId: DEFAULT_SITE_ID, deliveryDriverId: 'driver-1', orderType: 'DELIVERY' },
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
    expect(socket.emitToSite).toHaveBeenCalledWith(DEFAULT_SITE_ID, 'paymentUpdated', expect.anything());
  });

  it('records the exact cash and transfer portions of a mixed driver payment', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }),
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
      emitOrderStatusChange: jest.fn(),
      emitToSite: jest.fn(),
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
    expect(socket.emitToSite).toHaveBeenCalledWith(DEFAULT_SITE_ID, 'paymentUpdated', expect.anything());
  });

  it('never offers an operational account when configuring a driver portal', async () => {
    const prisma: any = {
      deliveryDriver: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

    await service.getAccessCandidates();

    expect(prisma.deliveryDriver.findMany).toHaveBeenCalledWith({
      where: { siteId: DEFAULT_SITE_ID, userId: { not: null } },
      select: { userId: true },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        active: true,
        siteMemberships: { some: { siteId: DEFAULT_SITE_ID, active: true, role: 'DELIVERY_DRIVER' } },
      }),
    }));
  });

  it('can link the same driver account to a separate profile in another site', async () => {
    const driverProfile = {
      id: 'driver-second-site',
      name: 'Juan Repartidor',
      phone: '3001234567',
      active: true,
      userId: null,
      user: null,
    };
    const prisma: any = {
      deliveryDriver: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(driverProfile)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ ...driverProfile, userId: 'shared-driver-account', user: { id: 'shared-driver-account' } }),
        update: jest.fn().mockResolvedValue({ ...driverProfile, userId: 'shared-driver-account' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'shared-driver-account',
          name: 'Juan Repartidor',
          email: 'juan.repartidor@thevilladog.local',
          role: 'DELIVERY_DRIVER',
          active: true,
          siteMemberships: [{ role: 'DELIVERY_DRIVER' }],
        }),
        findMany: jest.fn().mockResolvedValue([{
          id: 'shared-driver-account',
          name: 'Juan Repartidor',
          email: 'juan.repartidor@thevilladog.local',
          role: 'DELIVERY_DRIVER',
          siteMemberships: [{ role: 'DELIVERY_DRIVER' }],
        }]),
        update: jest.fn().mockResolvedValue({ id: 'shared-driver-account' }),
      },
      $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
    };
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

    await expect(service.configureAccess('driver-second-site', {
      mode: 'LINK',
      userId: 'shared-driver-account',
    }, SECOND_SITE_ID)).resolves.toEqual(expect.objectContaining({
      driver: expect.objectContaining({ id: 'driver-second-site' }),
    }));

    expect(prisma.deliveryDriver.findFirst).toHaveBeenNthCalledWith(2, {
      where: { siteId: SECOND_SITE_ID, userId: 'shared-driver-account' },
    });
    expect(prisma.deliveryDriver.update).toHaveBeenCalledWith({
      where: { id: 'driver-second-site' },
      data: { userId: 'shared-driver-account', active: true },
    });
  });

  it('rejects a driver login that matches another user after normalization', async () => {
    const prisma: any = {
      deliveryDriver: {
        findFirst: jest.fn().mockResolvedValue({
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
          {
            id: 'cook-1',
            name: 'Cocinero Principal',
            email: 'juan-p@otraempresa.com',
            role: 'KITCHEN',
            siteMemberships: [{ role: 'KITCHEN' }],
          },
        ]),
        create: jest.fn(),
      },
    };
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

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
        findFirst: jest.fn().mockResolvedValue({
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
          {
            id: 'admin-1',
            name: 'Juan-Padilla',
            email: 'administracion@thevilladog.local',
            role: 'ADMIN',
            siteMemberships: [{ role: 'ADMIN' }],
          },
        ]),
        create: jest.fn(),
      },
    };
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

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
        findFirst: jest.fn().mockResolvedValue({
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'operational-user',
          role: 'KITCHEN',
          siteMemberships: [{ role: 'KITCHEN' }],
        }),
        update: jest.fn(),
      },
    };
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

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
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'driver-1',
            name: 'Juan Padilla',
            phone: '3001234567',
            active: true,
            userId: null,
            user: null,
          })
          .mockResolvedValueOnce(null),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'driver-account',
          name: 'Repartidor 21',
          email: 'repartidor.21@thevilladog.local',
          role: 'DELIVERY_DRIVER',
          active: true,
          siteMemberships: [{ role: 'DELIVERY_DRIVER' }],
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'driver-account',
            name: 'Repartidor 21',
            email: 'repartidor.21@thevilladog.local',
            role: 'DELIVERY_DRIVER',
            siteMemberships: [{ role: 'DELIVERY_DRIVER' }],
          },
          {
            id: 'cook-1',
            name: 'Juán-Padilla',
            email: 'cocina.1@thevilladog.local',
            role: 'KITCHEN',
            siteMemberships: [{ role: 'KITCHEN' }],
          },
        ]),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

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
      deliveryDriver: { findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }) },
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
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

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
      deliveryDriver: { findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }) },
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
    const service = new DeliveryDriversService(prisma, makeSocketGateway() as any);

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
      deliveryDriver: { findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }) },
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
    const socket: any = makeSocketGateway();
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
    expect(socket.emitToSite).toHaveBeenCalledWith(
      DEFAULT_SITE_ID,
      'orderUpdated',
      expect.objectContaining({ id: 'order-1' }),
    );
  });

  it('rejects a file that only claims to be an image', async () => {
    await expect(validateReceipt({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      mimetype: 'image/svg+xml',
    })).rejects.toThrow('imagen válida');
  });

  it('never returns fileBase64 in uploadMyProof response', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      deliveryDriver: { findFirst: jest.fn().mockResolvedValue({ id: 'driver-1', active: true }) },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          total: 20_000,
          status: 'DELIVERED',
          orderType: 'DELIVERY',
          paymentMethod: 'TRANSFER',
          paymentStatus: 'PENDING_REVIEW',
          cashClosingId: 'active-shift',
        }),
        update: jest.fn().mockResolvedValue({ id: 'order-1', total: 20_000 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', total: 20_000 }),
      },
      cashClosing: { findFirst: jest.fn().mockResolvedValue({ id: 'active-shift', cashRegisterId: 'delivery-register' }) },
      payment: { upsert: jest.fn().mockResolvedValue({ id: 'pay-1', method: 'TRANSFER' }) },
      transferProof: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 'proof-1',
          fileBase64: 'data:image/jpeg;base64,HUGE_BASE64_STRING_THAT_SHOULD_BE_OMITTED',
          mimeType: 'image/jpeg',
          originalName: 'comprobante.jpg',
          sizeBytes: 1024,
        }),
      },
      orderChangeLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = { $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)) };
    const socket: any = makeSocketGateway();
    const service = new DeliveryDriversService(prisma, socket);

    const result = await service.uploadMyProof('driver-user', 'order-1', { method: 'TRANSFER' }, [{
      fieldname: 'proof',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimetype: 'image/jpeg',
      originalname: 'comprobante.jpg',
    }]);

    expect(result.order).toBeDefined();
    expect(result.proof).toBeDefined();
    expect((result.proof as any).fileBase64).toBeUndefined();
    expect((result.proof as any).id).toBe('proof-1');
    expect(JSON.stringify(result)).not.toContain('HUGE_BASE64_STRING');
  });
});


