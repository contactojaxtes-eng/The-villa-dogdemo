import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { isAllowedOrigin } from '../common/environment';

/**
 * Canal de solo lectura para clientes de la carta pública.
 * No comparte el namespace autenticado del personal ni acepta eventos del cliente.
 */
@WebSocketGateway({
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  },
  namespace: 'public-menu',
})
export class PublicMenuGateway {
  @WebSocketServer()
  server: Server;

  emitMenuUpdated() {
    this.server?.emit('menuUpdated', { updatedAt: new Date().toISOString() });
  }
}
