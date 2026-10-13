import { SocketGateway } from './socket.gateway';

describe('Authenticated real-time connections', () => {
  let middleware: any;
  let gateway: SocketGateway;
  let jwt: any;
  let db: any;
  let roomEmitter: any;
  beforeEach(() => {
    jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'staff', exp: Math.floor(Date.now() / 1000) + 60 }) };
    db = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'staff', name: 'Equipo', role: 'WAITER', active: true }) },
      order: { findFirst: jest.fn() },
    };
    gateway = new SocketGateway(jwt, db);
    gateway.afterInit({ use: (callback: any) => { middleware = callback; } } as any);
    roomEmitter = { emit: jest.fn() };
    gateway.server = { emit: jest.fn(), to: jest.fn().mockReturnValue(roomEmitter) } as any;
  });
  it('rejects anonymous connections even if they claim admin in the query', async () => {
    const next = jest.fn();
    await middleware({ handshake: { query: { userRole: 'SUPERADMIN' } }, data: {} }, next);
    expect(next.mock.calls[0][0].message).toBe('UNAUTHORIZED');
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
  it('uses the database role and rejects joining another users room', async () => {
    const client: any = { id: 'socket', handshake: { auth: { token: 'access' }, query: { userRole: 'SUPERADMIN' } }, data: {}, join: jest.fn(), disconnect: jest.fn() };
    const next = jest.fn();
    await middleware(client, next);
    gateway.handleConnection(client);
    gateway.handleJoinRoom(client, 'admins');
    gateway.handleJoinRoom(client, 'user:other');
    expect(client.join.mock.calls).toEqual([
      ['site:00000000-0000-4000-8000-000000000101'],
      ['site:00000000-0000-4000-8000-000000000101:user:staff'],
    ]);
    gateway.handleDisconnect(client);
  });
  it('rejects refresh tokens on the socket', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'staff', type: 'refresh', exp: 9999999999 });
    const next = jest.fn();
    await middleware({ handshake: { auth: { token: 'refresh' } }, data: {} }, next);
    expect(next.mock.calls[0][0].message).toBe('UNAUTHORIZED');
  });
  it('rejects delivery drivers from the global operations socket', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'driver', name: 'Domiciliario', role: 'DELIVERY_DRIVER', active: true });
    const next = jest.fn();
    await middleware({ handshake: { auth: { token: 'access' } }, data: {} }, next);
    expect(next.mock.calls[0][0].message).toBe('SOCKET_NOT_AVAILABLE');
  });
  it('rejects real-time connections while a site is still a draft', async () => {
    const siteAccess = {
      resolveActiveSite: jest.fn().mockResolvedValue({
        activeSite: {
          id: 'draft-site',
          organizationId: 'org-1',
          role: 'SUPERADMIN',
          permissions: ['*'],
          active: false,
          preparationMode: true,
        },
      }),
    };
    const draftGateway = new SocketGateway(jwt, db, siteAccess as any);
    let draftMiddleware: any;
    draftGateway.afterInit({
      use: (callback: any) => {
        draftMiddleware = callback;
      },
    } as any);
    const next = jest.fn();

    await draftMiddleware(
      { handshake: { auth: { token: 'access' } }, data: {} },
      next,
    );

    expect(next.mock.calls[0][0].message).toBe('SOCKET_NOT_AVAILABLE');
  });
  it('does not release presence while another tab is still connected', () => {
    const make = (id: string): any => ({ id, data: { user: { id: 'staff', name: 'Equipo', role: 'WAITER' }, expiresAt: Date.now() + 60000 }, join: jest.fn(), disconnect: jest.fn() });
    const first = make('first'); const second = make('second');
    gateway.handleConnection(first); gateway.handleConnection(second);
    gateway.handleDisconnect(first);
    expect(roomEmitter.emit).not.toHaveBeenCalledWith('userDisconnected', expect.anything());
    gateway.handleDisconnect(second);
    expect(roomEmitter.emit).toHaveBeenCalledWith('userDisconnected', { userId: 'staff' });
  });
  it('joins delivery advisors to the WhatsApp room', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'staff', name: 'Asesora', role: 'DELIVERY_MANAGER', active: true });
    const client: any = { id: 'socket', handshake: { auth: { token: 'access' } }, data: {}, join: jest.fn(), disconnect: jest.fn() };
    const next = jest.fn();
    await middleware(client, next);
    gateway.handleConnection(client);
    expect(client.join.mock.calls).toEqual([
      ['site:00000000-0000-4000-8000-000000000101'],
      ['site:00000000-0000-4000-8000-000000000101:user:staff'],
      ['site:00000000-0000-4000-8000-000000000101:whatsapp'],
    ]);
    gateway.handleDisconnect(client);
  });
  it('sends WhatsApp events only to the WhatsApp room', () => {
    const payload = { sessionId: 'chat-1' };
    gateway.emitWhatsApp('whatsappSessionUpdated', payload);
    expect(gateway.server.to).toHaveBeenCalledWith('site:00000000-0000-4000-8000-000000000101:whatsapp');
    expect(roomEmitter.emit).toHaveBeenCalledWith('whatsappSessionUpdated', payload);
  });

  it('routes operational events only to the payload site', () => {
    const secondSiteId = '00000000-0000-4000-8000-000000000102';
    const order = { id: 'order-b', siteId: secondSiteId };

    gateway.emitNewOrder(order);

    expect(gateway.server.to).toHaveBeenCalledWith(`site:${secondSiteId}`);
    expect(roomEmitter.emit).toHaveBeenCalledWith('newOrder', order);
    expect(gateway.server.emit).not.toHaveBeenCalledWith('newOrder', expect.anything());
  });

  it('keeps presence isolated when the same user is connected to two sites', () => {
    const principal = '00000000-0000-4000-8000-000000000101';
    const second = '00000000-0000-4000-8000-000000000102';
    const make = (id: string, siteId: string): any => ({
      id,
      data: { user: { id: 'staff', name: 'Equipo', role: 'WAITER', siteId }, expiresAt: Date.now() + 60000 },
      join: jest.fn(),
      disconnect: jest.fn(),
    });
    const first = make('principal-tab', principal);
    const secondTab = make('second-tab', second);

    gateway.handleConnection(first);
    gateway.handleConnection(secondTab);
    expect(gateway.getConnectionCounts()).toEqual({ users: 1, sockets: 2 });
    expect(gateway.getConnectionCounts(principal)).toEqual({ users: 1, sockets: 1 });
    expect(gateway.getConnectionCounts(second)).toEqual({ users: 1, sockets: 1 });
    gateway.handleDisconnect(first);

    expect(gateway.isUserConnected('staff', principal)).toBe(false);
    expect(gateway.isUserConnected('staff', second)).toBe(true);
    expect(gateway.server.to).toHaveBeenCalledWith(`site:${principal}`);
    gateway.handleDisconnect(secondTab);
  });

  it('does not allow claiming an order from another site', async () => {
    const secondSiteId = '00000000-0000-4000-8000-000000000102';
    db.order.findFirst.mockResolvedValue(null);
    const client: any = {
      data: { user: { id: 'staff', name: 'Equipo', role: 'ADMIN', permissions: ['orders.edit'], siteId: secondSiteId } },
      emit: jest.fn(),
    };

    await gateway.handleClaimOrder(client, { orderId: 'principal-order', userId: 'forged', userName: 'Falso' });

    expect(db.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'principal-order', siteId: secondSiteId },
      select: { id: true },
    });
    expect(roomEmitter.emit).not.toHaveBeenCalledWith('orderClaimed', expect.anything());
  });

  it('disconnects only sockets from the paused secondary site', () => {
    const principal = '00000000-0000-4000-8000-000000000101';
    const second = '00000000-0000-4000-8000-000000000102';
    const make = (id: string, siteId: string): any => ({
      id,
      data: {
        user: { id, name: id, role: 'ADMIN', siteId },
        expiresAt: Date.now() + 60_000,
      },
      join: jest.fn(),
      disconnect: jest.fn(),
    });
    const principalClient = make('principal-user', principal);
    const secondClientA = make('second-user-a', second);
    const secondClientB = make('second-user-b', second);
    gateway.handleConnection(principalClient);
    gateway.handleConnection(secondClientA);
    gateway.handleConnection(secondClientB);
    const disconnectSockets = jest.fn();
    (gateway.server as any).in = jest.fn().mockReturnValue({ disconnectSockets });

    const disconnected = gateway.disconnectSite(second);

    expect(disconnected).toBe(2);
    expect((gateway.server as any).in).toHaveBeenCalledWith(`site:${second}`);
    expect(disconnectSockets).toHaveBeenCalledWith(true);
    expect(gateway.isUserConnected('principal-user', principal)).toBe(true);
    expect(gateway.isUserConnected('second-user-a', second)).toBe(false);
    expect(gateway.isUserConnected('second-user-b', second)).toBe(false);
  });

  it('refuses to disconnect the principal room through the rollback helper', () => {
    (gateway.server as any).in = jest.fn();

    expect(gateway.disconnectSite('00000000-0000-4000-8000-000000000101')).toBe(0);
    expect((gateway.server as any).in).not.toHaveBeenCalled();
  });
});
