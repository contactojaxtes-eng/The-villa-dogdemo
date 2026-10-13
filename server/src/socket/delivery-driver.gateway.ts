import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { isAllowedOrigin } from '../common/environment';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

export type DriverPortalUpdate = {
  reason: string;
  orderId?: string;
  at?: string;
};

export type DriverOrderChatUpdate = {
  orderId: string;
  message: {
    id: string;
    direction: string;
    content: string;
    messageType: string;
    status: string;
    createdAt: Date | string;
    replyToContent: string | null;
    replyToDirection: string | null;
    hasMedia: boolean;
  };
};

/**
 * Canal exclusivo del portal del domiciliario.
 *
 * El namespace operativo general contiene información de otros pedidos, por lo
 * que DELIVERY_DRIVER permanece bloqueado allí. En este canal cada conexión se
 * une únicamente a la sala de su propia cuenta y los eventos son señales para
 * volver a consultar la API privada `/delivery-drivers/me`.
 */
@WebSocketGateway({
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  },
  namespace: 'delivery-driver',
})
export class DeliveryDriverGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        const token = client.handshake.auth?.token;
        if (typeof token !== 'string') return next(new Error('UNAUTHORIZED'));

        const payload = await this.jwt.verifyAsync(token, {
          secret: process.env.JWT_SECRET || 'change-me-the-villa-dog-dev-secret',
        });
        if (!payload.sub || payload.type === 'refresh' || !payload.exp) {
          return next(new Error('UNAUTHORIZED'));
        }

        const siteId = payload.siteId || DEFAULT_SITE_ID;
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            role: true,
            active: true,
            siteMemberships: {
              where: { siteId, active: true, site: { active: true } },
              select: { role: true },
              take: 1,
            },
          },
        });
        const membership = user?.siteMemberships?.[0];
        if (!user?.active || membership?.role !== 'DELIVERY_DRIVER') {
          return next(new Error('UNAUTHORIZED'));
        }

        const driver = await this.prisma.deliveryDriver.findFirst({
          where: { userId: user.id, siteId },
          select: { id: true, active: true },
        });
        if (!driver?.active) return next(new Error('DRIVER_NOT_AVAILABLE'));

        client.data.userId = user.id;
        client.data.driverId = driver.id;
        client.data.siteId = siteId;
        client.data.expiresAt = payload.exp * 1000;
        next();
      } catch (error) {
        next(new Error(error?.name === 'TokenExpiredError' ? 'SESSION_EXPIRED' : 'UNAUTHORIZED'));
      }
    });
  }

  handleConnection(client: Socket) {
    const userId = client.data.userId;
    const driverId = client.data.driverId;
    if (!userId || !driverId) {
      client.disconnect(true);
      return;
    }

    // No existe ningún evento general en este namespace. Una cuenta solo entra
    // en sus propias salas, que además no se aceptan desde mensajes del cliente.
    const siteId = client.data.siteId || DEFAULT_SITE_ID;
    client.join(this.driverUserRoom(siteId, userId));
    client.join(this.driverProfileRoom(siteId, driverId));
    client.data.expiryTimer = setTimeout(
      () => client.disconnect(true),
      Math.max(0, Math.min(client.data.expiresAt - Date.now(), 2_147_483_647)),
    );
  }

  handleDisconnect(client: Socket) {
    clearTimeout(client.data.expiryTimer);
  }

  private driverUserRoom(siteId: string, userId: string) {
    return `site:${siteId}:driver-user:${userId}`;
  }

  private driverProfileRoom(siteId: string, driverId: string) {
    return `site:${siteId}:driver-profile:${driverId}`;
  }

  emitToUser(
    userId: string | null | undefined,
    payload: DriverPortalUpdate,
    siteId = DEFAULT_SITE_ID,
  ): boolean {
    if (!userId || !this.server) return false;
    this.server.to(this.driverUserRoom(siteId || DEFAULT_SITE_ID, userId)).emit('driverPortalUpdated', {
      reason: String(payload.reason || 'changed'),
      ...(payload.orderId ? { orderId: String(payload.orderId) } : {}),
      at: payload.at || new Date().toISOString(),
    });
    return true;
  }

  async emitForDriver(
    driverId: string | null | undefined,
    payload: DriverPortalUpdate,
    siteId?: string,
  ): Promise<boolean> {
    if (!driverId) return false;
    try {
      const driver = await this.prisma.deliveryDriver.findFirst({
        where: { id: driverId, ...(siteId ? { siteId } : {}) },
        select: { userId: true, siteId: true },
      });
      return this.emitToUser(driver?.userId, payload, driver?.siteId || siteId || DEFAULT_SITE_ID);
    } catch {
      return false;
    }
  }

  async emitForDrivers(
    driverIds: Array<string | null | undefined>,
    payload: DriverPortalUpdate,
    siteId?: string,
  ): Promise<number> {
    const ids = [...new Set(driverIds.filter((id): id is string => Boolean(id)))];
    if (!ids.length) return 0;
    try {
      const drivers = await this.prisma.deliveryDriver.findMany({
        where: { id: { in: ids }, ...(siteId ? { siteId } : {}) },
        select: { userId: true, siteId: true },
      });
      let emitted = 0;
      for (const driver of drivers) {
        if (this.emitToUser(driver.userId, payload, driver.siteId)) emitted += 1;
      }
      return emitted;
    } catch {
      return 0;
    }
  }

  async emitForAllDrivers(payload: DriverPortalUpdate, siteId = DEFAULT_SITE_ID): Promise<number> {
    try {
      const drivers = await this.prisma.deliveryDriver.findMany({
        where: { siteId, active: true, userId: { not: null } },
        select: { userId: true },
      });
      let emitted = 0;
      for (const driver of drivers) {
        if (this.emitToUser(driver.userId, payload, siteId)) emitted += 1;
      }
      return emitted;
    } catch {
      return 0;
    }
  }

  async emitForOrder(
    orderOrId: any,
    payload: DriverPortalUpdate,
    siteId?: string,
  ): Promise<boolean> {
    if (!orderOrId) return false;
    if (typeof orderOrId === 'string') {
      try {
        const order = await this.prisma.order.findFirst({
          where: { id: orderOrId, ...(siteId ? { siteId } : {}) },
          select: { siteId: true, deliveryDriver: { select: { userId: true } } },
        });
        return this.emitToUser(
          order?.deliveryDriver?.userId,
          payload,
          order?.siteId || siteId || DEFAULT_SITE_ID,
        );
      } catch {
        return false;
      }
    }

    const directUserId = orderOrId.deliveryDriver?.userId;
    const resolvedSiteId = siteId || orderOrId.siteId || orderOrId.deliveryDriver?.siteId;
    if (directUserId) return this.emitToUser(directUserId, payload, resolvedSiteId || DEFAULT_SITE_ID);
    const driverId = orderOrId.deliveryDriverId || orderOrId.deliveryDriver?.id;
    return this.emitForDriver(driverId, payload, resolvedSiteId);
  }

  async emitChatMessageForOrder(orderId: string, message: DriverOrderChatUpdate['message']): Promise<boolean> {
    if (!orderId || !message?.id || !this.server) return false;
    try {
      const order = await this.prisma.order.findFirst({
        where: {
          id: orderId,
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
        select: { siteId: true, deliveryDriver: { select: { userId: true, active: true } } },
      });
      const userId = order?.deliveryDriver?.active ? order.deliveryDriver.userId : null;
      if (!userId) return false;
      this.server
        .to(this.driverUserRoom(order.siteId || DEFAULT_SITE_ID, userId))
        .emit('driverOrderChatMessage', { orderId, message });
      return true;
    } catch {
      return false;
    }
  }
}
