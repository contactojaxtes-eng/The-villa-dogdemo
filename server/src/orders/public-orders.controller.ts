import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrdersService } from './orders.service';

@ApiTags('Public Orders')
@Controller('public-orders')
export class PublicOrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Crear pedido desde el menú digital público' })
  async createPublicOrder(@Body() body: any) {
    if (!body || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
      throw new BadRequestException('El pedido no contiene productos');
    }

    let phone = String(body.customerPhone || body.phone || '');
    phone = phone.replace(/\D/g, '');
    if (phone.startsWith('57') && phone.length === 12) {
      phone = phone.substring(2);
    }
    if (!/^3\d{9}$/.test(phone)) throw new BadRequestException('Ingresa un celular válido');
    if (!['PICKUP', 'DELIVERY'].includes(body.orderType)) throw new BadRequestException('Tipo de pedido inválido');
    if (!['CASH', 'TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(body.paymentMethod)) throw new BadRequestException('Método de pago inválido');

    const orderData = {
      customerName: String(body.customerName || body.name || 'Cliente Web').trim().slice(0, 100),
      customerPhone: phone,
      customerAddress: String(body.customerAddress || body.address || 'Recoger en restaurante').slice(0, 300),
      zoneName: typeof body.zoneName === 'string' ? body.zoneName.slice(0, 100) : undefined,
      orderType: body.orderType,
      paymentMethod: body.paymentMethod,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : undefined,
      items: body.items.map((item: any) => ({ menuItemId: item.menuItemId, quantity: item.quantity, notes: typeof item.notes === 'string' ? item.notes.slice(0, 500) : undefined })),
      clientMutationId: typeof body.clientMutationId === 'string' && body.clientMutationId.length <= 100 ? body.clientMutationId : undefined,
      source: 'WEB',
      waiterId: null,
      status: 'PENDING'
    };

    const order = await this.ordersService.create(orderData);
    return { success: true, order };
  }
}
