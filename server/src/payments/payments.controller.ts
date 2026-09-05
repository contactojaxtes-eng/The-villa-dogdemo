import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get()
  @Permissions('payment_validation.view', 'cash.view')
  @ApiOperation({ summary: 'Listar todos los pagos' })
  findAll(@Query('status') status?: string, @Query('method') method?: string, @Query('date') date?: string, @Request() req?: any) {
    const isCashier = req.user?.role === 'CASHIER';
    return this.paymentsService.findAll({ status, method, date }, isCashier ? req.user.id : undefined);
  }

  @Put(':id/confirm')
  @Permissions('payment_validation.cash', 'payment_validation.transfer')
  @ApiOperation({ summary: 'Confirmar pago' })
  confirmPayment(@Param('id') id: string, @Request() req: any) {
    return this.paymentsService.confirmPayment(id, req.user.id);
  }

  @Put(':id/reject')
  @Permissions('payment_validation.reject')
  @ApiOperation({ summary: 'Rechazar pago' })
  rejectPayment(@Param('id') id: string, @Request() req: any) {
    return this.paymentsService.rejectPayment(id, req.user.id);
  }

  @Get('closing/today')
  @Permissions('cash.view')
  @ApiOperation({ summary: 'Resumen de caja del día' })
  getTodayClosing(@Request() req: any, @Query('cashRegisterId') cashRegisterId?: string) {
    return this.paymentsService.getCashClosingToday(req.user.id, cashRegisterId);
  }

  @Get('closing/all-today')
  @Permissions('cash.control')
  @ApiOperation({ summary: 'Todas las cajas abiertas del día' })
  getAllTodayClosings() {
    return this.paymentsService.getAllCashClosingsToday();
  }

  @Post('closing')
  @Permissions('cash.open_close')
  @ApiOperation({ summary: 'Realizar cierre de caja' })
  createCashClosing(@Body() body: any, @Request() req: any) {
    return this.paymentsService.createCashClosing(req.user.id, body);
  }

  @Get('closing/history')
  @Permissions('cash.view', 'drivers.view')
  @ApiOperation({ summary: 'Historial de cierres de caja' })
  getCashClosings(@Query('date') date?: string, @Query('userId') userIdQuery?: string, @Query('cashRegisterId') cashRegisterId?: string, @Request() req?: any) {
    const isCashier = req.user?.role === 'CASHIER';
    const userId = isCashier ? req.user.id : userIdQuery;
    return this.paymentsService.getCashClosings({ date, userId, cashRegisterId });
  }

  @Get('closing/:id/detail')
  @Permissions('cash.view', 'drivers.view')
  @ApiOperation({ summary: 'Detalle expandido de un cierre para Reporte Z' })
  getClosingDetail(@Param('id') id: string) {
    return this.paymentsService.getClosingDetail(id);
  }

  @Get('closing/consolidated/report')
  @Permissions('cash.control')
  @ApiOperation({ summary: 'Reporte consolidado de todas las cajas por fecha' })
  getConsolidatedClosing(@Query('date') date?: string) {
    return this.paymentsService.getConsolidatedClosing(date);
  }

  @Post('opening')
  @Permissions('cash.open_close')
  @ApiOperation({ summary: 'Apertura de caja' })
  openCash(@Body() body: { initialCash: number; cashRegisterId?: string }, @Request() req: any) {
    return this.paymentsService.openCash(req.user.id, body);
  }

  @Get('opening/status')
  @Permissions('cash.view', 'orders.create')
  @ApiOperation({ summary: 'Verificar si hay caja abierta' })
  getOpenCash(@Request() req: any) {
    return this.paymentsService.getOpenCash(req.user.id);
  }

  @Put('credit/:orderId/pay')
  @Permissions('customers.credit', 'cash.open_close')
  @ApiOperation({ summary: 'Liquidar crédito de cartera' })
  payCreditOrder(
    @Param('orderId') orderId: string,
    @Body() body: { method: string; reference?: string },
    @Request() req: any
  ) {
    return this.paymentsService.payCreditOrder(orderId, body, req.user.id);
  }
}
