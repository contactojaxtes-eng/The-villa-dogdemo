import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { isAllowedOrigin } from '../common/environment';
import { DEFAULT_ROLE_PERMISSIONS } from '../auth/permissions.constant';
import { SiteAccessService } from '../auth/site-access.service';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@WebSocketGateway({ cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true }, namespace: 'the-villa-dog' })
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, Set<string>>();
  private activeOperators: Map<string, { siteId: string; userId: string; userName: string; orderId: string }> = new Map();
  private activeChatViewers = new Map<string, {
    siteId: string;
    sessionId: string;
    viewers: Map<string, string>;
  }>();

  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
    private siteAccess?: SiteAccessService,
  ) {}

  private siteRoom(siteId?: string | null) {
    return `site:${siteId || DEFAULT_SITE_ID}`;
  }

  private siteNamedRoom(siteId: string | null | undefined, room: string) {
    return `${this.siteRoom(siteId)}:${room}`;
  }

  private siteUserRoom(siteId: string | null | undefined, userId: string) {
    return this.siteNamedRoom(siteId, `user:${userId}`);
  }

  private siteEntityKey(siteId: string | null | undefined, entityId: string) {
    return `${siteId || DEFAULT_SITE_ID}:${entityId}`;
  }

  private inferSiteId(payload?: any, explicitSiteId?: string | null) {
    return explicitSiteId
      || payload?.siteId
      || payload?.order?.siteId
      || payload?.table?.siteId
      || payload?.ticket?.siteId
      || DEFAULT_SITE_ID;
  }

  emitToSite(siteId: string | null | undefined, event: string, payload?: any) {
    const room = this.server.to(this.siteRoom(siteId));
    if (payload === undefined) room.emit(event);
    else room.emit(event, payload);
  }

  emitToSiteUser(siteId: string | null | undefined, userId: string, event: string, payload?: any) {
    const room = this.server.to(this.siteUserRoom(siteId, userId));
    if (payload === undefined) room.emit(event);
    else room.emit(event, payload);
  }

  emitToSiteRoles(siteId: string | null | undefined, roles: string[], event: string, payload?: any) {
    const rooms = roles.map(role => this.siteNamedRoom(siteId, role));
    const target = this.server.to(rooms);
    if (payload === undefined) target.emit(event);
    else target.emit(event, payload);
  }

  getConnectionCounts(siteId?: string | null) {
    let sockets = 0;
    const userIds = new Set<string>();
    for (const [key, ids] of this.connectedUsers.entries()) {
      if (siteId && !key.startsWith(`${siteId}:`)) continue;
      sockets += ids.size;
      userIds.add(key.slice(key.lastIndexOf(':') + 1));
    }
    return { users: userIds.size, sockets };
  }

  private hasPermission(user: any, permission: string) {
    if (user?.role === 'SUPERADMIN') return true;
    let permissions = user?.permissions;
    if (typeof permissions === 'string') {
      try { permissions = JSON.parse(permissions); } catch { permissions = null; }
    }
    const effective = Array.isArray(permissions)
      ? permissions
      : (DEFAULT_ROLE_PERMISSIONS[user?.role] || []);
    return effective.includes('*') || effective.includes(permission);
  }

  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        const token = client.handshake.auth?.token;
        if (typeof token !== 'string') return next(new Error('UNAUTHORIZED'));
        const payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_SECRET || 'change-me-the-villa-dog-dev-secret' });
        if (!payload.sub || payload.type === 'refresh' || !payload.exp) return next(new Error('UNAUTHORIZED'));
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            name: true,
            role: true,
            isOrganizationAdmin: true,
            permissions: true,
            active: true,
            createdAt: true,
            lastActiveSiteId: true,
          },
        });
        if (!user?.active) return next(new Error('UNAUTHORIZED'));
        const activeSite = this.siteAccess
          ? (await this.siteAccess.resolveActiveSite(user, payload.siteId)).activeSite
          : {
              id: payload.siteId || DEFAULT_SITE_ID,
              organizationId: payload.organizationId,
              role: user.role,
              permissions: user.permissions,
              active: true,
              preparationMode: false,
            };
        // Un borrador solo admite las rutas HTTP de configuración marcadas de
        // forma explícita. No abre tiempo real ni recibe datos operativos.
        if (activeSite.active === false || activeSite.preparationMode === true) {
          return next(new Error('SOCKET_NOT_AVAILABLE'));
        }
        // El portal del domiciliario consulta únicamente su API privada. No
        // puede conectarse al canal global, donde otros módulos difunden datos
        // operativos completos de pedidos y mesas.
        const effectiveUser = {
          ...user,
          role: user.role === 'SUPERADMIN'
            ? 'SUPERADMIN'
            : user.isOrganizationAdmin === true
              ? 'ADMIN'
              : activeSite.role,
          globalRole: user.role === 'SUPERADMIN'
            ? 'SUPERADMIN'
            : user.isOrganizationAdmin === true
              ? 'ADMIN_GENERAL'
              : null,
          permissions: user.role === 'SUPERADMIN' || user.isOrganizationAdmin === true
            ? user.permissions
            : activeSite.permissions,
          siteId: activeSite.id,
          organizationId: activeSite.organizationId,
        };
        if (effectiveUser.role === 'DELIVERY_DRIVER') return next(new Error('SOCKET_NOT_AVAILABLE'));
        client.data.user = effectiveUser;
        client.data.expiresAt = payload.exp * 1000;
        next();
      } catch (error) {
        next(new Error(error?.name === 'TokenExpiredError' ? 'SESSION_EXPIRED' : 'UNAUTHORIZED'));
      }
    });
  }

  handleConnection(client: Socket) {
    const user = client.data.user;
    if (!user) { client.disconnect(true); return; }
    const connectionKey = this.siteEntityKey(user.siteId, user.id);
    const sockets = this.connectedUsers.get(connectionKey) || new Set<string>();
    sockets.add(client.id);
    this.connectedUsers.set(connectionKey, sockets);
    client.join(this.siteRoom(user.siteId));
    client.join(this.siteUserRoom(user.siteId, user.id));
    if (['ADMIN', 'SUPERADMIN'].includes(user.role)) client.join(this.siteNamedRoom(user.siteId, 'admins'));
    if (user.role === 'CASHIER') client.join(this.siteNamedRoom(user.siteId, 'cashiers'));
    if (this.canJoinWhatsApp(user)) client.join(this.siteNamedRoom(user.siteId, 'whatsapp'));
    client.data.expiryTimer = setTimeout(() => client.disconnect(true), Math.max(0, Math.min(client.data.expiresAt - Date.now(), 2_147_483_647)));
    if (sockets.size === 1) this.emitToSite(user.siteId, 'userConnected', { userId: user.id, userName: user.name, connected: true });
  }

  handleDisconnect(client: Socket) {
    clearTimeout(client.data.expiryTimer);
    const user = client.data.user;
    const userId = user?.id;
    if (!userId) return;
    const siteId = user.siteId || DEFAULT_SITE_ID;
    const connectionKey = this.siteEntityKey(siteId, userId);
    const sockets = this.connectedUsers.get(connectionKey);
    sockets?.delete(client.id);
    if (sockets?.size) return;
    this.connectedUsers.delete(connectionKey);
    this.emitToSite(siteId, 'userDisconnected', { userId });
    for (const [operatorKey, operator] of this.activeOperators.entries()) {
      if (operator.siteId === siteId && operator.userId === userId) {
        this.activeOperators.delete(operatorKey);
        this.emitToSite(siteId, 'orderUnassigned', { orderId: operator.orderId });
      }
    }
    for (const [viewerKey, state] of this.activeChatViewers.entries()) {
      if (state.siteId === siteId && state.viewers.has(userId)) {
        state.viewers.delete(userId);
        if (state.viewers.size === 0) this.activeChatViewers.delete(viewerKey);
        this.emitChatViewers(state.sessionId, siteId);
      }
    }
  }

  private canJoinWhatsApp(user: any) {
    return !['KITCHEN', 'WAITER'].includes(user.role)
      && (this.hasPermission(user, 'whatsapp.view')
        || ['ADMIN', 'SUPERADMIN', 'WA_ADVISOR', 'DELIVERY_MANAGER', 'CASHIER'].includes(user.role));
  }

  private resolveRequestedRoom(user: any, room: string) {
    if (room === `user:${user.id}`) return this.siteUserRoom(user.siteId, user.id);
    if (room === 'admins' && ['ADMIN', 'SUPERADMIN'].includes(user.role)) return this.siteNamedRoom(user.siteId, 'admins');
    if (room === 'cashiers' && user.role === 'CASHIER') return this.siteNamedRoom(user.siteId, 'cashiers');
    if (room === 'whatsapp' && this.canJoinWhatsApp(user)) return this.siteNamedRoom(user.siteId, 'whatsapp');
    return null;
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(client: Socket, room: string) {
    const user = client.data.user;
    if (!user || typeof room !== 'string') return;
    const scopedRoom = this.resolveRequestedRoom(user, room);
    if (scopedRoom) client.join(scopedRoom);
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(client: Socket, room: string) {
    const user = client.data.user;
    if (!user || typeof room !== 'string') return;
    const scopedRoom = this.resolveRequestedRoom(user, room);
    if (scopedRoom) client.leave(scopedRoom);
  }

  @SubscribeMessage('claimOrder')
  async handleClaimOrder(client: Socket, data: { orderId: string; userId: string; userName: string }) {
    const user = client.data.user;
    if (!user || (!this.hasPermission(user, 'orders.edit') && !this.hasPermission(user, 'dispatch.change_status')) || typeof data?.orderId !== 'string') return;
    const order = await this.prisma.order.findFirst({
      where: { id: data.orderId, siteId: user.siteId || DEFAULT_SITE_ID },
      select: { id: true },
    });
    if (!order) return;
    data = { ...data, userId: user.id, userName: user.name };
    const siteId = user.siteId || DEFAULT_SITE_ID;
    const operatorKey = this.siteEntityKey(siteId, data.orderId);
    const existing = this.activeOperators.get(operatorKey);
    if (existing && existing.userId !== data.userId) {
      client.emit('orderAlreadyClaimed', { orderId: data.orderId, operator: existing });
      return;
    }

    this.activeOperators.set(operatorKey, {
      siteId,
      userId: data.userId,
      userName: data.userName,
      orderId: data.orderId,
    });

    this.emitToSite(siteId, 'orderClaimed', {
      orderId: data.orderId,
      operatorId: data.userId,
      operatorName: data.userName,
    });
  }

  @SubscribeMessage('releaseOrder')
  handleReleaseOrder(client: Socket, data: { orderId: string; userId: string }) {
    if (!client.data.user || typeof data?.orderId !== 'string') return;
    data = { ...data, userId: client.data.user.id };
    const siteId = client.data.user.siteId || DEFAULT_SITE_ID;
    const operatorKey = this.siteEntityKey(siteId, data.orderId);
    const existing = this.activeOperators.get(operatorKey);
    if (existing && existing.userId === data.userId) {
      this.activeOperators.delete(operatorKey);
      this.emitToSite(siteId, 'orderReleased', { orderId: data.orderId });
    }
  }

  @SubscribeMessage('getActiveOperators')
  handleGetActiveOperators(client: Socket) {
    const operators: Record<string, { userId: string; userName: string }> = {};
    const siteId = client.data.user?.siteId || DEFAULT_SITE_ID;
    for (const operator of this.activeOperators.values()) {
      if (operator.siteId === siteId) operators[operator.orderId] = { userId: operator.userId, userName: operator.userName };
    }
    client.emit('activeOperators', operators);
  }

  emitChatViewers(sessionId: string, siteId = DEFAULT_SITE_ID) {
    const state = this.activeChatViewers.get(this.siteEntityKey(siteId, sessionId));
    const list = state ? Array.from(state.viewers.entries()).map(([userId, userName]) => ({ userId, userName })) : [];
    this.server.to(this.siteNamedRoom(siteId, 'whatsapp')).emit('chatViewersUpdated', { sessionId, viewers: list });
  }

  @SubscribeMessage('chatViewJoin')
  handleChatViewJoin(client: Socket, data: { sessionId: string }) {
    const user = client.data.user;
    if (!user || !this.canJoinWhatsApp(user) || !data?.sessionId || typeof data.sessionId !== 'string') return;
    const siteId = user.siteId || DEFAULT_SITE_ID;
    const viewerKey = this.siteEntityKey(siteId, data.sessionId);
    let state = this.activeChatViewers.get(viewerKey);
    if (!state) {
      state = { siteId, sessionId: data.sessionId, viewers: new Map() };
      this.activeChatViewers.set(viewerKey, state);
    }
    state.viewers.set(user.id, user.name);
    this.emitChatViewers(data.sessionId, siteId);
  }

  @SubscribeMessage('chatViewLeave')
  handleChatViewLeave(client: Socket, data: { sessionId: string }) {
    const user = client.data.user;
    if (!user || !this.canJoinWhatsApp(user) || !data?.sessionId || typeof data.sessionId !== 'string') return;
    const siteId = user.siteId || DEFAULT_SITE_ID;
    const viewerKey = this.siteEntityKey(siteId, data.sessionId);
    const state = this.activeChatViewers.get(viewerKey);
    if (state) {
      state.viewers.delete(user.id);
      if (state.viewers.size === 0) this.activeChatViewers.delete(viewerKey);
      this.emitChatViewers(data.sessionId, siteId);
    }
  }

  @SubscribeMessage('chatTyping')
  handleChatTyping(client: Socket, data: { sessionId: string; isTyping: boolean }) {
    const user = client.data.user;
    if (!user || !this.canJoinWhatsApp(user) || !data?.sessionId || typeof data.sessionId !== 'string') return;
    this.server.to(this.siteNamedRoom(user.siteId, 'whatsapp')).emit('chatTypingUpdated', {
      sessionId: data.sessionId,
      userId: user.id,
      userName: user.name,
      isTyping: Boolean(data.isTyping),
    });
  }

  @SubscribeMessage('getChatViewers')
  handleGetChatViewers(client: Socket) {
    const result: Record<string, { userId: string; userName: string }[]> = {};
    if (!client.data.user || !this.canJoinWhatsApp(client.data.user)) {
      client.emit('allChatViewers', result);
      return;
    }
    const siteId = client.data.user?.siteId || DEFAULT_SITE_ID;
    for (const state of this.activeChatViewers.values()) {
      if (state.siteId === siteId) result[state.sessionId] = Array.from(state.viewers.entries()).map(([userId, userName]) => ({ userId, userName }));
    }
    client.emit('allChatViewers', result);
  }

  emitNewOrder(order: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(order, explicitSiteId);
    this.emitToSite(siteId, 'newOrder', order);
    this.emitToSite(siteId, 'cashRegistersChanged');
  }

  emitOrderStatusChange(orderId: string, status: string, order: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(order, explicitSiteId);
    this.emitToSite(siteId, 'orderStatusChanged', { orderId, status, order });
    this.emitToSite(siteId, 'orderUpdated', order);
    this.emitToSite(siteId, 'cashRegistersChanged');
    
    if (status === 'DELIVERED' || status === 'CANCELLED') {
      this.activeOperators.delete(this.siteEntityKey(siteId, orderId));
      this.emitToSite(siteId, 'orderReleased', { orderId });
    }
  }

  emitOrderAssigned(orderId: string, operatorId: string | null, operatorName: string | null, order: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(order, explicitSiteId);
    const operatorKey = this.siteEntityKey(siteId, orderId);
    if (operatorId && operatorName) {
      this.activeOperators.set(operatorKey, {
        siteId,
        userId: operatorId,
        userName: operatorName,
        orderId,
      });
      this.emitToSite(siteId, 'orderClaimed', { orderId, operatorId, operatorName });
    } else {
      this.activeOperators.delete(operatorKey);
      this.emitToSite(siteId, 'orderReleased', { orderId });
    }
  }

  emitNewNotification(userId: string, notification: any, explicitSiteId?: string) {
    this.emitToSiteUser(this.inferSiteId(notification, explicitSiteId), userId, 'newNotification', notification);
  }

  emitRankingUpdate(ranking: any, explicitSiteId?: string) {
    this.emitToSite(this.inferSiteId(ranking, explicitSiteId), 'rankingUpdated', ranking);
  }

  emitDashboardUpdate(stats: any, explicitSiteId?: string) {
    this.emitToSite(this.inferSiteId(stats, explicitSiteId), 'dashboardUpdated', stats);
  }

  emitWhatsApp(event: string, payload: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(payload, explicitSiteId);
    this.server.to(this.siteNamedRoom(siteId, 'whatsapp')).emit(event, payload);
  }

  emitTableCreated(table: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(table, explicitSiteId);
    this.emitToSite(siteId, 'tableCreated', table);
    this.emitToSite(siteId, 'cashRegistersChanged');
  }

  emitTableUpdated(table: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(table, explicitSiteId);
    this.emitToSite(siteId, 'tableUpdated', table);
    this.emitToSite(siteId, 'cashRegistersChanged');
  }

  emitTableClosed(table: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(table, explicitSiteId);
    this.emitToSite(siteId, 'tableClosed', table);
    this.emitToSite(siteId, 'cashRegistersChanged');
  }

  emitKitchenTicketCreated(ticket: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(ticket, explicitSiteId);
    this.emitToSite(siteId, 'kitchenTicketCreated', ticket);
    this.emitToSite(siteId, 'kitchenTicketUpdated', ticket);
  }

  emitKitchenTicketUpdated(ticket: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(ticket, explicitSiteId);
    this.emitToSite(siteId, 'kitchenTicketUpdated', ticket);
  }

  emitKitchenTicketEdited(ticket: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(ticket, explicitSiteId);
    this.emitToSite(siteId, 'kitchenTicketEdited', ticket);
    this.emitToSite(siteId, 'kitchenTicketUpdated', ticket);
  }

  emitKitchenTicketReady(waiterId: string, ticket: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(ticket, explicitSiteId);
    this.emitToSite(siteId, 'kitchenTicketReady', ticket);
  }

  emitDiningKitchenTicketDelayed(ticket: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(ticket, explicitSiteId);
    // Una comanda de salón solo debe alertar a quien puede atenderla. Socket.IO
    // combina los cuartos y entrega una única copia aunque un usuario aparezca
    // en más de uno.
    const recipientIds = new Set<string>();
    const waiterId = ticket?.order?.waiterId || ticket?.order?.waiter?.id;
    if (waiterId) recipientIds.add(waiterId);

    if (ticket?.assignedToId) {
      recipientIds.add(ticket.assignedToId);
    } else {
      for (const member of ticket?.station?.users || []) {
        if (member?.id && member?.role === 'KITCHEN') recipientIds.add(member.id);
      }
    }

    const rooms = Array.from(recipientIds, userId => this.siteUserRoom(siteId, userId));
    rooms.push(this.siteNamedRoom(siteId, 'admins'));
    this.server.to(rooms).emit('diningKitchenTicketDelayed', ticket);
  }

  emitPaymentSubmitted(payload: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(payload, explicitSiteId);
    this.emitToSiteRoles(siteId, ['admins', 'cashiers'], 'paymentSubmitted', payload);
    this.emitToSite(siteId, 'cashRegistersChanged');
  }

  emitPaymentValidated(payload: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(payload, explicitSiteId);
    this.emitToSite(siteId, 'paymentValidated', payload);
    this.emitToSite(siteId, 'cashRegistersChanged');
  }

  emitPaymentRejected(waiterId: string, payload: any, explicitSiteId?: string) {
    const siteId = this.inferSiteId(payload, explicitSiteId);
    const rooms = [
      this.siteNamedRoom(siteId, 'admins'),
      this.siteNamedRoom(siteId, 'cashiers'),
      this.siteUserRoom(siteId, waiterId),
    ];
    this.server.to(rooms).emit('paymentRejected', payload);
  }

  emitOrderCancellationRequested(payload: any, explicitSiteId?: string) {
    this.emitToSite(this.inferSiteId(payload, explicitSiteId), 'cancellationRequested', payload);
  }

  emitOrderCancellationResolved(payload: any, explicitSiteId?: string) {
    this.emitToSite(this.inferSiteId(payload, explicitSiteId), 'cancellationResolved', payload);
  }

  emitForceRefresh(payload: { triggeredBy: string; triggeredByName: string }) {
    this.server.emit('forceRefresh', payload);
    return { clientsNotified: this.getConnectionCounts().users };
  }

  disconnectSite(siteId: string) {
    const cleanSiteId = String(siteId || '').trim();
    if (!cleanSiteId || cleanSiteId === DEFAULT_SITE_ID) return 0;

    const connectionPrefix = `${cleanSiteId}:`;
    let socketsDisconnected = 0;
    for (const [key, socketIds] of this.connectedUsers.entries()) {
      if (!key.startsWith(connectionPrefix)) continue;
      socketsDisconnected += socketIds.size;
    }

    // Socket.IO desconecta únicamente el cuarto raíz de esta sede. Las demás
    // sedes, incluida la principal, permanecen conectadas y siguen recibiendo
    // sus eventos en tiempo real.
    const target = this.server?.in?.(this.siteRoom(cleanSiteId));
    target?.disconnectSockets?.(true);

    // Limpiar cualquier presencia residual aunque el adaptador entregue los
    // eventos de desconexión de forma asíncrona.
    for (const key of Array.from(this.connectedUsers.keys())) {
      if (key.startsWith(connectionPrefix)) this.connectedUsers.delete(key);
    }
    for (const [key, operator] of this.activeOperators.entries()) {
      if (operator.siteId === cleanSiteId) this.activeOperators.delete(key);
    }
    for (const [key, state] of this.activeChatViewers.entries()) {
      if (state.siteId === cleanSiteId) this.activeChatViewers.delete(key);
    }

    return socketsDisconnected;
  }

  getActiveOperatorsMap(siteId = DEFAULT_SITE_ID) {
    const result = new Map<string, { userId: string; userName: string; orderId: string }>();
    for (const operator of this.activeOperators.values()) {
      if (operator.siteId === siteId) result.set(operator.orderId, operator);
    }
    return result;
  }

  isUserConnected(userId: string, siteId?: string): boolean {
    if (siteId) return !!this.connectedUsers.get(this.siteEntityKey(siteId, userId))?.size;
    for (const [key, sockets] of this.connectedUsers.entries()) {
      if (key.endsWith(`:${userId}`) && sockets.size > 0) return true;
    }
    return false;
  }
}
