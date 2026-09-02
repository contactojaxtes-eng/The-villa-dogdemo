import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { TablesService } from './tables.service';

@ApiTags('Kitchen')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kitchen')
export class KitchenController {
  constructor(private tablesService: TablesService) {}

  @Get('tickets')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Tickets de cocina por estacion/usuario' })
  tickets(@Query('status') status: string, @Query('stationId') stationId: string, @Request() req: any) {
    return this.tablesService.listKitchenTickets(req.user, { status, stationId });
  }

  @Put('tickets/:id/status')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Cambiar estado de ticket de cocina' })
  updateTicket(@Param('id') id: string, @Body('status') status: string, @Request() req: any) {
    return this.tablesService.updateKitchenTicket(id, status, req.user);
  }

  @Get('stations')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Listar estaciones de cocina' })
  stations() {
    return this.tablesService.listStations();
  }

  @Post('stations')
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Crear o editar estacion de cocina' })
  saveStation(@Body() body: any) {
    return this.tablesService.saveStation(body);
  }

  @Delete('stations/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Eliminar estacion de cocina' })
  deleteStation(@Param('id') id: string) {
    return this.tablesService.deleteStation(id);
  }

  @Get('settings')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Configuracion de distribucion inteligente de cocina' })
  getKitchenSettings() {
    return this.tablesService.getKitchenSettings();
  }

  @Post('settings')
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Actualizar configuracion de distribucion de cocina' })
  updateKitchenSettings(@Body() body: any) {
    return this.tablesService.updateKitchenSettings(body);
  }
}
