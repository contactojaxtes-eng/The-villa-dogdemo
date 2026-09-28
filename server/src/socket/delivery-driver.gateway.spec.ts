import { DeliveryDriverGateway } from './delivery-driver.gateway';

describe('DeliveryDriverGateway private channel', () => {
  let middleware: any;
  let jwt: any;
  let prisma: any;
  let gateway: DeliveryDriverGateway;
  let roomEmitter: any;

  beforeEach(() => {
    jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'driver-user-1',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'driver-user-1',
          role: 'DELIVERY_DRIVER',
          active: true,
        }),
      },
      deliveryDriver: {
        findUnique: jest.fn().mockResolvedValue({ id: 'driver-1', active: true, userId: 'driver-user-1' }),
        findMany: jest.fn().mockResolvedValue([
          { userId: 'driver-user-1' },
          { userId: 'driver-user-2' },
        ]),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          deliveryDriver: { userId: 'driver-user-1' },
        }),
        findFirst: jest.fn().mockResolvedValue({
          deliveryDriver: { userId: 'driver-user-1', active: true },
        }),
      },
    };
    roomEmitter = { emit: jest.fn() };
    gateway = new DeliveryDriverGateway(jwt, prisma);
    gateway.afterInit({ use: (callback: any) => { middleware = callback; } } as any);
    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      emit: jest.fn(),
    } as any;
  });

  it('accepts only an active linked delivery-driver account', async () => {
    const client: any = {
      id: 'socket-1',
      handshake: { auth: { token: 'access-token' } },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    const next = jest.fn();

    await middleware(client, next);
    gateway.handleConnection(client);

    expect(next).toHaveBeenCalledWith();
    expect(client.join.mock.calls).toEqual([
      ['driver-user:driver-user-1'],
      ['driver-profile:driver-1'],
    ]);
    gateway.handleDisconnect(client);
  });

  it('rejects every non-driver role even with a valid access token', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'ADMIN', active: true });
    const next = jest.fn();

    await middleware({ handshake: { auth: { token: 'access-token' } }, data: {} }, next);

    expect(next.mock.calls[0][0].message).toBe('UNAUTHORIZED');
    expect(prisma.deliveryDriver.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a driver account that is not linked to an active profile', async () => {
    prisma.deliveryDriver.findUnique.mockResolvedValue(null);
    const next = jest.fn();

    await middleware({ handshake: { auth: { token: 'access-token' } }, data: {} }, next);

    expect(next.mock.calls[0][0].message).toBe('DRIVER_NOT_AVAILABLE');
  });

  it('emits a refresh signal only to the requested driver user room', () => {
    gateway.emitToUser('driver-user-1', {
      reason: 'assignment_changed',
      orderId: 'order-123',
      at: '2026-09-18T12:00:00.000Z',
    });

    expect(gateway.server.to).toHaveBeenCalledTimes(1);
    expect(gateway.server.to).toHaveBeenCalledWith('driver-user:driver-user-1');
    expect(gateway.server.emit).not.toHaveBeenCalled();
    expect(roomEmitter.emit).toHaveBeenCalledWith('driverPortalUpdated', {
      reason: 'assignment_changed',
      orderId: 'order-123',
      at: '2026-09-18T12:00:00.000Z',
    });
  });

  it('resolves reassignment recipients without exposing one driver payload to another room', async () => {
    await gateway.emitForDrivers(['driver-1', 'driver-2', 'driver-1'], {
      reason: 'assignment_changed',
      orderId: 'order-123',
      at: '2026-09-18T12:00:00.000Z',
    });

    expect(prisma.deliveryDriver.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['driver-1', 'driver-2'] } },
      select: { userId: true },
    });
    expect((gateway.server.to as jest.Mock).mock.calls).toEqual([
      ['driver-user:driver-user-1'],
      ['driver-user:driver-user-2'],
    ]);
    expect(gateway.server.emit).not.toHaveBeenCalled();
  });

  it('emits an order chat message only to the currently assigned driver private room', async () => {
    const message = {
      id: 'message-1',
      direction: 'IN',
      content: 'Ya hice la transferencia',
      messageType: 'text',
      status: 'received',
      createdAt: '2026-09-27T18:00:00.000Z',
      replyToContent: null,
      replyToDirection: null,
      hasMedia: false,
    };

    await expect(gateway.emitChatMessageForOrder('order-1', message)).resolves.toBe(true);

    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        orderType: 'DELIVERY',
        OR: [
          { status: { notIn: ['DELIVERED', 'CANCELLED'] } },
          {
            status: 'DELIVERED',
            cashClosing: {
              isOpen: true,
              cashRegister: { purpose: 'DELIVERY', active: true },
            },
          },
        ],
      },
      select: { deliveryDriver: { select: { userId: true, active: true } } },
    });
    expect(gateway.server.to).toHaveBeenCalledWith('driver-user:driver-user-1');
    expect(roomEmitter.emit).toHaveBeenCalledWith('driverOrderChatMessage', {
      orderId: 'order-1',
      message,
    });
    expect(gateway.server.emit).not.toHaveBeenCalled();
  });

  it('does not emit chat messages for orders outside the driver current view', async () => {
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(gateway.emitChatMessageForOrder('old-order', {
      id: 'message-old',
      direction: 'IN',
      content: 'Comprobante anterior',
      messageType: 'image',
      status: 'received',
      createdAt: '2026-09-27T18:00:00.000Z',
      replyToContent: null,
      replyToDirection: null,
      hasMedia: true,
    })).resolves.toBe(false);

    expect(gateway.server.to).not.toHaveBeenCalled();
    expect(roomEmitter.emit).not.toHaveBeenCalled();
  });

});
