import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los pedidos' })
  findAll(
    @Query('status') status?: string,
    @Query('waiterId') waiterId?: string,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('orderNumber') orderNumber?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('orderType') orderType?: string,
  ) {
    return this.ordersService.findAll({
      status,
      waiterId,
      date,
      startDate,
      endDate,
      search,
      orderNumber: orderNumber ? parseInt(orderNumber) : undefined,
      paymentMethod,
      paymentStatus,
      orderType,
    });
  }

  @Get('active')
  @ApiOperation({ summary: 'Obtener pedidos activos' })
  getActiveOrders() {
    return this.ordersService.getActiveOrders();
  }

  @Get('stats/today')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Estadísticas del día' })
  getTodayStats() {
    return this.ordersService.getTodayStats();
  }

  @Get('dashboard-stats')
  @ApiOperation({ summary: 'Estadísticas para el dashboard' })
  getDashboardStats(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.ordersService.getDashboardStats(startDate, endDate);
  }

  @Get('can-create')
  @ApiOperation({ summary: 'Verificar si se pueden crear pedidos (caja abierta)' })
  canCreate(@Request() req: any, @Query('orderType') orderType?: string) {
    return this.ordersService.checkCanCreateOrders(req.user.id, req.user.role, orderType || 'DELIVERY');
  }

  @Get('history/:phone')
  @ApiOperation({ summary: 'Historial de pedidos por teléfono' })
  getCustomerHistory(@Param('phone') phone: string) {
    return this.ordersService.getCustomerHistory(phone);
  }

  @Get('number/:orderNumber')
  @ApiOperation({ summary: 'Buscar por número de orden' })
  findByNumber(@Param('orderNumber') orderNumber: string) {
    return this.ordersService.findByNumber(parseInt(orderNumber));
  }

  @Get('cancellations/pending')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Listar pedidos con cancelación pendiente de aprobación' })
  listPendingCancellations() {
    return this.ordersService.listPendingCancellations();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener pedido por ID' })
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear nuevo pedido' })
  create(@Body() body: any, @Request() req: any) {
    return this.ordersService.create({
      ...body,
      waiterId: body.waiterId || req.user?.id,
      assignedTo: body.assignedTo || req.user?.id,
      userId: req.user?.id,
      userRole: req.user?.role,
    });
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'CASHIER', 'WAITER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar pedido completo' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.ordersService.update(id, body);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Actualizar estado del pedido' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('deliveryDriverId') deliveryDriverId: string,
    @Request() req: any,
  ) {
    return this.ordersService.updateStatus(id, status, req.user, deliveryDriverId);
  }

  @Put(':id/cancel')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cancelar pedido con motivo o solicitar cancelación' })
  cancelOrder(@Param('id') id: string, @Body('reason') reason: string, @Request() req: any) {
    return this.ordersService.cancelOrder(id, reason || 'Sin motivo', req.user);
  }

  @Put(':id/cancellation/approve')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Aprobar solicitud de cancelación de pedido' })
  approveCancellation(@Param('id') id: string, @Request() req: any) {
    return this.ordersService.approveCancellation(id, req.user);
  }

  @Put(':id/cancellation/reject')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Rechazar solicitud de cancelación de pedido' })
  rejectCancellation(@Param('id') id: string, @Body('reason') reason: string, @Request() req: any) {
    return this.ordersService.rejectCancellation(id, req.user, reason);
  }

  @Put(':id/assign')
  @ApiOperation({ summary: 'Asignar operador al pedido' })
  assignOperator(@Param('id') id: string, @Body() body: { operatorId: string | null; operatorName: string | null }) {
    return this.ordersService.assignOperator(id, body.operatorId, body.operatorName);
  }

  @Put(':id/rate')
  @ApiOperation({ summary: 'Calificar pedido' })
  rateOrder(@Param('id') id: string, @Body('rating') rating: number) {
    return this.ordersService.rateOrder(id, rating);
  }

  @Put(':id/payment')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar método y estado de pago' })
  updatePayment(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.ordersService.updatePayment(id, body.method, body.paymentStatus, body.reference, req.user, body.customerId, body.courtesyItemIds, body.cashAmount, body.transferAmount);
  }
}
