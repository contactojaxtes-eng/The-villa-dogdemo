import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { TablesService } from './tables.service';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';

@ApiTags('Kitchen')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kitchen')
export class KitchenController {
  constructor(private tablesService: TablesService) {}

  @Get('tickets')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Tickets de cocina por estacion/usuario' })
  tickets(
    @Query('status') status: string,
    @Query('stationId') stationId: string,
    @Query('currentShift') currentShift: string,
    @Request() req: any,
  ) {
    return this.tablesService.listKitchenTickets(req.user, { status, stationId, currentShift });
  }

  @Put('tickets/:id/status')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Cambiar estado de ticket de cocina' })
  updateTicket(@Param('id') id: string, @Body('status') status: string, @Request() req: any) {
    return this.tablesService.updateKitchenTicket(id, status, req.user);
  }

  @Get('stations')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Listar estaciones de cocina' })
  stations(@Request() req: any) {
    return this.tablesService.listStations(req.user.siteId);
  }

  @Post('stations')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Crear o editar estacion de cocina' })
  saveStation(@Body() body: any, @Request() req: any) {
    return this.tablesService.saveStation(body, req.user.siteId);
  }

  @Delete('stations/:id')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Eliminar estacion de cocina' })
  deleteStation(@Param('id') id: string, @Request() req: any) {
    return this.tablesService.deleteStation(id, req.user.siteId);
  }

  @Get('settings')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Configuracion de distribucion inteligente de cocina' })
  getKitchenSettings(@Request() req: any) {
    return this.tablesService.getKitchenSettings(undefined, req.user.siteId);
  }

  @Post('settings')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Actualizar configuracion de distribucion de cocina' })
  updateKitchenSettings(@Body() body: any, @Request() req: any) {
    return this.tablesService.updateKitchenSettings(body, req.user.siteId);
  }

  @Get('cooks/status')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Consultar estado de cocineros (activo, en cena, etc.)' })
  getCookStatuses(@Request() req: any) {
    return this.tablesService.getCookStatuses(undefined, req.user.siteId);
  }

  @Post('cooks/:userId/status')
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Actualizar disponibilidad de cocinero o activar tiempo de cena' })
  updateCookStatus(@Param('userId') userId: string, @Body() body: any, @Request() req: any) {
    return this.tablesService.updateCookStatus(userId, body, req.user.siteId);
  }

  @Get('delivery/cooks/status')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'KITCHEN')
  @ApiOperation({ summary: 'Consultar disponibilidad de cocineros de domicilios' })
  getDeliveryCookStatuses(@Request() req: any) {
    return this.tablesService.getDeliveryCookStatuses(undefined, req.user.siteId);
  }

  @Post('delivery/cooks/:userId/status')
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({ summary: 'Actualizar disponibilidad de un cocinero solo para domicilios' })
  updateDeliveryCookStatus(@Param('userId') userId: string, @Body() body: any, @Request() req: any) {
    return this.tablesService.updateDeliveryCookStatus(userId, body, req.user.siteId);
  }
}
