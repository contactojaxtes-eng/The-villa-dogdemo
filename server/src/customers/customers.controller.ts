import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear un nuevo cliente' })
  create(@Body() body: { name: string; phone: string; address?: string }) {
    return this.customersService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los clientes' })
  findAll(@Query('search') search?: string) {
    return this.customersService.findAll(search);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un cliente por ID con su historial' })
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar un cliente' })
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; phone?: string; address?: string; active?: boolean },
  ) {
    return this.customersService.update(id, body);
  }

  @Post(':id/payments')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Registrar abono a la deuda del cliente' })
  addPayment(
    @Param('id') id: string,
    @Body() body: { amount: number; method: string; reference?: string; notes?: string },
    @Request() req: any,
  ) {
    return this.customersService.addPayment(id, body, req.user.id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar (desactivar) un cliente' })
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
