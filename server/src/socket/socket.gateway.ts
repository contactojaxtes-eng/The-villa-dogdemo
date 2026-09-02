import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*', credentials: true }, namespace: 'the-villa-dog' })
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<string, string> = new Map();
  private activeOperators: Map<string, { userId: string; userName: string; orderId: string }> = new Map();

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    const userName = client.handshake.query.userName as string;
    if (userId) {
      this.connectedUsers.set(userId, client.id);
      this.server.emit('userConnected', { userId, userName, connected: true });
    }
  }

  handleDisconnect(client: Socket) {
    let disconnectedUserId: string | null = null;
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        disconnectedUserId = userId;
        break;
      }
    }

    if (disconnectedUserId) {
      this.server.emit('userDisconnected', { userId: disconnectedUserId });
      
      for (const [orderId, operator] of this.activeOperators.entries()) {
        if (operator.userId === disconnectedUserId) {
          this.activeOperators.delete(orderId);
          this.server.emit('orderUnassigned', { orderId });
        }
      }
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(client: Socket, room: string) {
    client.join(room);
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(client: Socket, room: string) {
    client.leave(room);
  }

  @SubscribeMessage('claimOrder')
  handleClaimOrder(client: Socket, data: { orderId: string; userId: string; userName: string }) {
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
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('newNotification', notification);
    }
  }

  emitRankingUpdate(ranking: any) {
    this.server.emit('rankingUpdated', ranking);
  }

  emitDashboardUpdate(stats: any) {
    this.server.emit('dashboardUpdated', stats);
  }

  emitForceRefresh(payload: { triggeredBy: string; triggeredByName: string }) {
    this.server.emit('forceRefresh', payload);
    return { clientsNotified: this.connectedUsers.size };
  }

  getActiveOperatorsMap() {
    return this.activeOperators;
  }
}
