import { Body, Controller, Get, Param, Post, Put, Query, Request, UseGuards, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { TablesService } from './tables.service';

@ApiTags('Tables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tables')
export class TablesController {
  constructor(private tablesService: TablesService) {}

  @Get()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Listar mesas abiertas o historicas' })
  findAll(@Query('status') status?: string, @Query('search') search?: string, @Query('waiterId') waiterId?: string) {
    return this.tablesService.listTables({ status, search, waiterId });
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Detalle de mesa/cuenta' })
  findOne(@Param('id') id: string) {
    return this.tablesService.findTable(id);
  }

  @Post()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Crear mesa libre' })
  create(@Body() body: any, @Request() req: any) {
    return this.tablesService.createTable(body, req.user);
  }

  @Post('orders')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Crear pedido de mesa y enviarlo a cocina' })
  async createOrder(@Body() body: any, @Request() req: any) {
    try {
      console.log('>>> [TablesController] createOrder called by user:', req.user?.id, req.user?.email, req.user?.role);
      return await this.tablesService.createTableOrder(body, req.user);
    } catch (e: any) {
      console.error('>>> [TablesController] createOrder ERROR:', e.message, e.stack);
      throw e;
    }
  }

  @Put('orders/:orderId')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Editar pedido de mesa y avisar a cocina' })
  updateOrder(@Param('orderId') orderId: string, @Body() body: any, @Request() req: any) {
    return this.tablesService.updateTableOrder(orderId, body, req.user);
  }

  @Post(':id/payments')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 10 * 1024 * 1024, files: 10 } }))
  @ApiOperation({ summary: 'Enviar cobro de mesa para validacion (soporta múltiples comprobantes)' })
  submitPayment(@Param('id') id: string, @Body() body: any, @Request() req: any, @UploadedFiles() files?: any[]) {
    return this.tablesService.submitPayment(id, body, req.user, files);
  }

  @Put(':id/close')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Cerrar mesa pagada y lista' })
  close(@Param('id') id: string, @Request() req: any) {
    return this.tablesService.closeTable(id, req.user);
  }
}
