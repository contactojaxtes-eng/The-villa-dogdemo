import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los pagos' })
  findAll(@Query('status') status?: string, @Query('method') method?: string, @Query('date') date?: string, @Request() req?: any) {
    const isCashier = req.user?.role === 'CASHIER';
    return this.paymentsService.findAll({ status, method, date }, isCashier ? req.user.id : undefined);
  }

  @Put(':id/confirm')
  @ApiOperation({ summary: 'Confirmar pago' })
  confirmPayment(@Param('id') id: string, @Request() req: any) {
    return this.paymentsService.confirmPayment(id, req.user.id);
  }

  @Put(':id/reject')
  @ApiOperation({ summary: 'Rechazar pago' })
  rejectPayment(@Param('id') id: string, @Request() req: any) {
    return this.paymentsService.rejectPayment(id, req.user.id);
  }

  @Get('closing/today')
  @ApiOperation({ summary: 'Resumen de caja del día' })
  getTodayClosing(@Request() req: any, @Query('cashRegisterId') cashRegisterId?: string) {
    return this.paymentsService.getCashClosingToday(req.user.id, cashRegisterId);
  }

  @Get('closing/all-today')
  @ApiOperation({ summary: 'Todas las cajas abiertas del día' })
  getAllTodayClosings() {
    return this.paymentsService.getAllCashClosingsToday();
  }

  @Post('closing')
  @ApiOperation({ summary: 'Realizar cierre de caja' })
  createCashClosing(@Body() body: any, @Request() req: any) {
    return this.paymentsService.createCashClosing(req.user.id, body);
  }

  @Get('closing/history')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DISPATCHER')
  @ApiOperation({ summary: 'Historial de cierres de caja' })
  getCashClosings(@Query('date') date?: string, @Query('userId') userIdQuery?: string, @Query('cashRegisterId') cashRegisterId?: string, @Request() req?: any) {
    const isCashier = req.user?.role === 'CASHIER';
    const userId = isCashier ? req.user.id : userIdQuery;
    return this.paymentsService.getCashClosings({ date, userId, cashRegisterId });
  }

  @Get('closing/:id/detail')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DISPATCHER')
  @ApiOperation({ summary: 'Detalle expandido de un cierre para Reporte Z' })
  getClosingDetail(@Param('id') id: string) {
    return this.paymentsService.getClosingDetail(id);
  }

  @Get('closing/consolidated/report')
  @ApiOperation({ summary: 'Reporte consolidado de todas las cajas por fecha' })
  getConsolidatedClosing(@Query('date') date?: string) {
    return this.paymentsService.getConsolidatedClosing(date);
  }

  @Post('opening')
  @ApiOperation({ summary: 'Apertura de caja' })
  openCash(@Body() body: { initialCash: number; cashRegisterId?: string }, @Request() req: any) {
    return this.paymentsService.openCash(req.user.id, body);
  }

  @Get('opening/status')
  @ApiOperation({ summary: 'Verificar si hay caja abierta' })
  getOpenCash(@Request() req: any) {
    return this.paymentsService.getOpenCash(req.user.id);
  }

  @Put('credit/:orderId/pay')
  @ApiOperation({ summary: 'Liquidar crédito de cartera' })
  payCreditOrder(
    @Param('orderId') orderId: string,
    @Body() body: { method: string; reference?: string },
    @Request() req: any
  ) {
    return this.paymentsService.payCreditOrder(orderId, body, req.user.id);
  }
}
