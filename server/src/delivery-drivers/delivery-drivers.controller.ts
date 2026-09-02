import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DeliveryDriversService } from './delivery-drivers.service';
import { CreateDriverDto, UpdateDriverDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Delivery Drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery-drivers')
export class DeliveryDriversController {
  constructor(private readonly deliveryDriversService: DeliveryDriversService) {}

  @Post()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear un nuevo domiciliario' })
  create(@Body() body: CreateDriverDto) {
    return this.deliveryDriversService.create(body);
  }

  @Get()
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

  @Get(':id')
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
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @UseGuards(RolesGuard)
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
  