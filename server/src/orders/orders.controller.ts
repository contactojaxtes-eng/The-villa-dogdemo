import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions('orders.view', 'dispatch.view', 'whatsapp.view')
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
  @UseGuards(PermissionsGuard)
  @Permissions('dispatch.view')
  @ApiOperation({ summary: 'Obtener pedidos activos' })
  getActiveOrders(@Query('search') search?: string, @Request() req?: any) {
    return this.ordersService.getActiveOrders(search, req?.user?.role);
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
  @UseGuards(PermissionsGuard)
  @Permissions('orders.create', 'whatsapp.order_create')
  @ApiOperation({ summary: 'Verificar si se pueden crear pedidos (caja abierta)' })
  canCreate(@Request() req: any, @Query('orderType') orderType?: string) {
    return this.ordersService.checkCanCreateOrders(req.user.id, req.user.role, orderType || 'DELIVERY');
  }

  @Get('history/:phone')
  @UseGuards(PermissionsGuard)
  @Permissions('orders.view', 'whatsapp.view')
  @ApiOperation({ summary: 'Historial de pedidos por teléfono' })
  getCustomerHistory(@Param('phone') phone: string) {
    return this.ordersService.getCustomerHistory(phone);
  }

  @Get('history')
  @UseGuards(PermissionsGuard)
  @Permissions('orders.view', 'dispatch.view')
  @ApiOperation({ summary: 'Historial paginado de domicilios y pedidos para recoger' })
  getDeliveryHistory(
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('orderType') orderType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordersService.findDeliveryHistory({
      status,
      startDate,
      endDate,
      search,
      orderType: orderType || 'DELIVERY,PICKUP',
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('number/:orderNumber')
  @UseGuards(PermissionsGuard)
  @Permissions('orders.view', 'dispatch.view', 'whatsapp.view')
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
  @UseGuards(PermissionsGuard)
  @Permissions('orders.view', 'dispatch.view', 'whatsapp.view')
  @ApiOperation({ summary: 'Obtener pedido por ID' })
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @Permissions('orders.create', 'whatsapp.order_create')
  @UseGuards(PermissionsGuard)
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

  @Put('batch-dispatch')
  @Permissions('dispatch.change_status')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Asignar repartidor a múltiples pedidos en lote' })
  batchAssignDriver(
    @Body('orderIds') orderIds: string[],
    @Body('deliveryDriverId') deliveryDriverId: string,
    @Request() req: any,
  ) {
    return this.ordersService.batchAssignDriver(orderIds, deliveryDriverId, req.user);
  }

  @Put('batch-collect')
  @Permissions('orders.edit', 'payment_validation.cash', 'payment_validation.transfer')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Cobrar múltiples pedidos en lote' })
  batchCollectPayments(
    @Body('orders') ordersPayload: any[],
    @Body('globalMethod') globalMethod: string,
    @Body('globalReference') globalReference: string,
    @Request() req: any,
  ) {
    return this.ordersService.batchCollectPayments(ordersPayload, globalMethod, globalReference, req.user);
  }

  @Put(':id')
  @Permissions('orders.edit')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Actualizar pedido completo' })
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.ordersService.update(id, body, req?.user);
  }

  @Put(':id/status')
  @Permissions('dispatch.change_status')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Actualizar estado del pedido' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('deliveryDriverId') deliveryDriverId: string,
    @Request() req: any,
    @Body('notifyCustomer') notifyCustomer?: boolean,
  ) {
    return this.ordersService.updateStatus(id, status, req.user, deliveryDriverId, notifyCustomer);
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
  @Permissions('orders.edit', 'dispatch.change_status')
  @UseGuards(PermissionsGuard)
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
  @Permissions('orders.edit', 'payment_validation.cash', 'payment_validation.transfer')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Actualizar método y estado de pago' })
  updatePayment(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.ordersService.updatePayment(id, body.method, body.paymentStatus, body.reference, req.user, body.customerId, body.courtesyItemIds, body.cashAmount, body.transferAmount);
  }
}
