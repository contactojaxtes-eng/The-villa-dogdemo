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
    if (!body || !body.items || body.items.length === 0) {
      throw new BadRequestException('El pedido no contiene productos');
    }

    let phone = body.customerPhone || body.phone || '';
    phone = phone.replace(/\D/g, '');
    if (phone.startsWith('57') && phone.length === 12) {
      phone = phone.substring(2);
    }

    const orderData = {
      ...body,
      customerName: body.customerName || body.name || 'Cliente Web',
      customerPhone: phone,
      customerAddress: body.customerAddress || body.address || 'Recoger en restaurante',
      zoneName: body.zoneName || body.neighborhood || undefined,
      source: 'WEB',
      waiterId: null,
      status: 'PENDING'
    };

    const order = await this.ordersService.create(orderData);
    return { success: true, order };
  }
}
