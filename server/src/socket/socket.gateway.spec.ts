import { SocketGateway } from './socket.gateway';

describe('Authenticated real-time connections', () => {
  let middleware: any;
  let gateway: SocketGateway;
  let jwt: any;
  let db: any;
  let roomEmitter: any;
  beforeEach(() => {
    jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'staff', exp: Math.floor(Date.now() / 1000) + 60 }) };
    db = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'staff', name: 'Equipo', role: 'WAITER', active: true }) } };
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
    expect(client.join.mock.calls).toEqual([['user:staff']]);
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
  it('does not release presence while another tab is still connected', () => {
    const make = (id: string): any => ({ id, data: { user: { id: 'staff', name: 'Equipo', role: 'WAITER' }, expiresAt: Date.now() + 60000 }, join: jest.fn(), disconnect: jest.fn() });
    const first = make('first'); const second = make('second');
    gateway.handleConnection(first); gateway.handleConnection(second);
    gateway.handleDisconnect(first);
    expect(gateway.server.emit).not.toHaveBeenCalledWith('userDisconnected', expect.anything());
    gateway.handleDisconnect(second);
    expect(gateway.server.emit).toHaveBeenCalledWith('userDisconnected', { userId: 'staff' });
  });
  it('joins delivery advisors to the WhatsApp room', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'staff', name: 'Asesora', role: 'DELIVERY_MANAGER', active: true });
    const client: any = { id: 'socket', handshake: { auth: { token: 'access' } }, data: {}, join: jest.fn(), disconnect: jest.fn() };
    const next = jest.fn();
    await middleware(client, next);
    gateway.handleConnection(client);
    expect(client.join.mock.calls).toEqual([['user:staff'], ['whatsapp']]);
    gateway.handleDisconnect(client);
  });
  it('sends WhatsApp events only to the WhatsApp room', () => {
    const payload = { sessionId: 'chat-1' };
    gateway.emitWhatsApp('whatsappSessionUpdated', payload);
    expect(gateway.server.to).toHaveBeenCalledWith('whatsapp');
    expect(roomEmitter.emit).toHaveBeenCalledWith('whatsappSessionUpdated', payload);
  });
});
