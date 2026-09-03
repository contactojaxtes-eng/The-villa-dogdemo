import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { isAllowedOrigin } from '../common/environment';

@WebSocketGateway({ cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true }, namespace: 'the-villa-dog' })
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, Set<string>>();
  private activeOperators: Map<string, { userId: string; userName: string; orderId: string }> = new Map();

  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        const token = client.handshake.auth?.token;
        if (typeof token !== 'string') return next(new Error('UNAUTHORIZED'));
        const payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_SECRET || 'change-me-the-villa-dog-dev-secret' });
        if (!payload.sub || payload.type === 'refresh' || !payload.exp) return next(new Error('UNAUTHORIZED'));
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, role: true, active: true } });
        if (!user?.active) return next(new Error('UNAUTHORIZED'));
        client.data.user = user;
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
    const sockets = this.connectedUsers.get(user.id) || new Set<string>();
    sockets.add(client.id);
    this.connectedUsers.set(user.id, sockets);
    client.join(`user:${user.id}`);
    if (['ADMIN', 'SUPERADMIN'].includes(user.role)) client.join('admins');
    if (user.role === 'CASHIER') client.join('cashiers');
    client.data.expiryTimer = setTimeout(() => client.disconnect(true), Math.max(0, Math.min(client.data.expiresAt - Date.now(), 2_147_483_647)));
    if (sockets.size === 1) this.server.emit('userConnected', { userId: user.id, userName: user.name, connected: true });
  }

  handleDisconnect(client: Socket) {
    clearTimeout(client.data.expiryTimer);
    const userId = client.data.user?.id;
    if (!userId) return;
    const sockets = this.connectedUsers.get(userId);
    sockets?.delete(client.id);
    if (sockets?.size) return;
    this.connectedUsers.delete(userId);
    this.server.emit('userDisconnected', { userId });
    for (const [orderId, operator] of this.activeOperators.entries()) {
      if (operator.userId === userId) {
        this.activeOperators.delete(orderId);
        this.server.emit('orderUnassigned', { orderId });
      }
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(client: Socket, room: string) {
    const user = client.data.user;
    if (!user || typeof room !== 'string') return;
    if (room === `user:${user.id}` || (room === 'admins' && ['ADMIN', 'SUPERADMIN'].includes(user.role)) || (room === 'cashiers' && user.role === 'CASHIER')) client.join(room);
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(client: Socket, room: string) {
    client.leave(room);
  }

  @SubscribeMessage('claimOrder')
  handleClaimOrder(client: Socket, data: { orderId: string; userId: string; userName: string }) {
    const user = client.data.user;
    if (!user || !['ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER'].includes(user.role) || typeof data?.orderId !== 'string') return;
    data = { ...data, userId: user.id, userName: user.name };
    const existing = this.activeOperators.get(data.orderId);
    if (existing && existing.userId !== data.userId) {
      client.emit('orderAlreadyClaimed', { orderId: data.orderId, operator: existing });
      return;
    }

    this.activeOperators.set(data.orderId, {
      userId: data.userId,
      userName: data.userName,
      orderId: data.orderId,
    });

    this.server.emit('orderClaimed', {
      orderId: data.orderId,
      operatorId: data.userId,
      operatorName: data.userName,
    });
  }

  @SubscribeMessage('releaseOrder')
  handleReleaseOrder(client: Socket, data: { orderId: string; userId: string }) {
    if (!client.data.user || typeof data?.orderId !== 'string') return;
    data = { ...data, userId: client.data.user.id };
    const existing = this.activeOperators.get(data.orderId);
    if (existing && existing.userId === data.userId) {
      this.activeOperators.delete(data.orderId);
      this.server.emit('orderReleased', { orderId: data.orderId });
    }
  }

  @SubscribeMessage('getActiveOperators')
  handleGetActiveOperators(client: Socket) {
    const operators: Record<string, { userId: string; userName: string }> = {};
    for (const [orderId, operator] of this.activeOperators.entries()) {
      operators[orderId] = { userId: operator.userId, userName: operator.userName };
    }
    client.emit('activeOperators', operators);
  }

  emitNewOrder(order: any) {
    this.server.emit('newOrder', order);
  }

  emitOrderStatusChange(orderId: string, status: string, order: any) {
    this.server.emit('orderStatusChanged', { orderId, status, order });
    this.server.emit('orderUpdated', order);
    
    if (status === 'DELIVERED' || status === 'CANCELLED') {
      this.activeOperators.delete(orderId);
      this.server.emit('orderReleased', { orderId });
    }
  }

  emitOrderAssigned(orderId: string, operatorId: string | null, operatorName: string | null, order: any) {
    if (operatorId && operatorName) {
      this.activeOperators.set(orderId, {
        userId: operatorId,
        userName: operatorName,
        orderId,
      });
      this.server.emit('orderClaimed', { orderId, operatorId, operatorName });
    } else {
      this.activeOperators.delete(orderId);
      this.server.emit('orderReleased', { orderId });
    }
  }

  emitNewNotification(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('newNotification', notification);
  }

  emitRankingUpdate(ranking: any) {
    this.server.emit('rankingUpdated', ranking);
  }

  emitDashboardUpdate(stats: any) {
    this.server.emit('dashboardUpdated', stats);
  }

  emitTableCreated(table: any) {
    this.server.emit('tableCreated', table);
    this.server.emit('tableUpdated', table);
  }

  emitTableUpdated(table: any) {
    this.server.emit('tableUpdated', table);
  }

  emitTableClosed(table: any) {
    this.server.emit('tableClosed', table);
    this.server.emit('tableUpdated', table);
  }

  emitKitchenTicketCreated(ticket: any) {
    this.server.to(`kitchen:${ticket.stationId}`).emit('kitchenTicketCreated', ticket);
    if (ticket.assignedToId) this.server.to(`user:${ticket.assignedToId}`).emit('kitchenTicketCreated', ticket);
    this.server.emit('kitchenTicketCreated', ticket);
    this.server.emit('kitchenTicketUpdated', ticket);
  }

  emitKitchenTicketUpdated(ticket: any) {
    this.server.to(`kitchen:${ticket.stationId}`).emit('kitchenTicketUpdated', ticket);
    if (ticket.assignedToId) this.server.to(`user:${ticket.assignedToId}`).emit('kitchenTicketUpdated', ticket);
    this.server.emit('kitchenTicketUpdated', ticket);
  }

  emitKitchenTicketEdited(ticket: any) {
    this.server.to(`kitchen:${ticket.stationId}`).emit('kitchenTicketEdited', ticket);
    if (ticket.assignedToId) this.server.to(`user:${ticket.assignedToId}`).emit('kitchenTicketEdited', ticket);
    this.server.emit('kitchenTicketEdited', ticket);
    this.server.emit('kitchenTicketUpdated', ticket);
  }

  emitKitchenTicketReady(waiterId: string, ticket: any) {
    if (waiterId) {
      this.server.to(`user:${waiterId}`).emit('kitchenTicketReady', ticket);
    }
    this.server.emit('kitchenTicketReady', ticket);
  }

  emitPaymentSubmitted(payload: any) {
    this.server.to('admins').to('cashiers').emit('paymentSubmitted', payload);
  }

  emitPaymentValidated(payload: any) {
    this.server.emit('paymentValidated', payload);

  }

  emitPaymentRejected(waiterId: string, payload: any) {
    this.server.to('admins').to('cashiers').to(`user:${waiterId}`).emit('paymentRejected', payload);
  }

  emitOrderCancellationRequested(payload: any) {
    this.server.to('admins').to('cashiers').emit('cancellationRequested', payload);
    this.server.emit('cancellationRequested', payload);
  }

  emitOrderCancellationResolved(payload: any) {
    this.server.emit('cancellationResolved', payload);
  }

  emitForceRefresh(payload: { triggeredBy: string; triggeredByName: string }) {
    this.server.emit('forceRefresh', payload);
    return { clientsNotified: this.connectedUsers.size };
  }

  getActiveOperatorsMap() {
    return this.activeOperators;
  }

  isUserConnected(userId: string): boolean {
    const sockets = this.connectedUsers.get(userId);
    return !!(sockets && sockets.size > 0);
  }
}
