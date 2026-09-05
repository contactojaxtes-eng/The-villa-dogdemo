import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DeliveryDriversService } from './delivery-drivers.service';
import { CreateDriverDto, UpdateDriverDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';

@ApiTags('Delivery Drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery-drivers')
export class DeliveryDriversController {
  constructor(private readonly deliveryDriversService: DeliveryDriversService) {}

  @Post()
  @Permissions('drivers.manage')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Crear un nuevo domiciliario' })
  create(@Body() body: CreateDriverDto) {
    return this.deliveryDriversService.create(body);
  }

  @Get()
  @Permissions('drivers.view', 'dispatch.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Listar todos los domiciliarios' })
  findAll(
    @Query('activeOnly') activeOnly?: string,
    @Query('filterType') filterType?: string,
    @Query('cashClosingId') cashClosingId?: string,
    @Query('selectedDate') selectedDate?: string,
  ) {
    const active = activeOnly === 'true';
    return this.deliveryDriversService.findAll(active, filterType || 'CURRENT', cashClosingId, selectedDate);
  }

  @Get('settlements/pending')
  @Permissions('dispatch.view', 'cash.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Efectivo pendiente por entregar de los domiciliarios' })
  getPendingSettlements() {
    return this.deliveryDriversService.getPendingSettlements();
  }

  @Post(':id/settlements')
  @Permissions('dispatch.change_status', 'cash.open_close')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Recibir y liquidar efectivo de un domiciliario' })
  settleCash(
    @Param('id') id: string,
    @Body() body: { orderIds: string[]; receivedCash: number; notes?: string },
    @Request() req: any,
  ) {
    return this.deliveryDriversService.settleCash(id, body, req.user.id);
  }

  @Get(':id/settlements')
  @Permissions('drivers.view', 'cash.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Historial de liquidaciones de un domiciliario' })
  getSettlements(@Param('id') id: string) {
    return this.deliveryDriversService.getSettlements(id);
  }

  @Get(':id')
  @Permissions('drivers.view', 'dispatch.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Obtener un domiciliario por ID con sus pedidos' })
  findOne(
    @Param('id') id: string,
    @Query('filterType') filterType?: string,
    @Query('cashClosingId') cashClosingId?: string,
    @Query('selectedDate') selectedDate?: string,
  ) {
    return this.deliveryDriversService.findOne(id, filterType, cashClosingId, selectedDate);
  }

  @Put(':id')
  @Permissions('drivers.manage')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Actualizar un domiciliario' })
  update(@Param('id') id: string, @Body() body: UpdateDriverDto) {
    return this.deliveryDriversService.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar (desactivar) un domiciliario' })
  remove(@Param('id') id: string) {
    return this.deliveryDriversService.remove(id);
  }
}
