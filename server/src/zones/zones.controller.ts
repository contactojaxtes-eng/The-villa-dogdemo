import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZonesService } from './zones.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';

@ApiTags('Delivery Zones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('zones')
export class ZonesController {
  constructor(private zonesService: ZonesService) {}

  @Get()
  @AllowDraftSiteSetup()
  @Permissions('zones.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Listar todas las zonas' })
  findAll(@Request() req: any) {
    return this.zonesService.findAll(req.user.siteId);
  }

  @Get('groups')
  @AllowDraftSiteSetup()
  @Permissions('zones.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Listar grupos de zonas' })
  getGroups(@Request() req: any) {
    return this.zonesService.getGroups(req.user.siteId);
  }

  @Post('groups')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear un nuevo grupo de zona' })
  createGroup(@Body() body: { name: string }, @Request() req: any) {
    return this.zonesService.createGroup(body.name, req.user.siteId);
  }

  @Put('groups/:oldName')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar un grupo de zona' })
  updateGroup(@Param('oldName') oldName: string, @Body() body: { newName: string }, @Request() req: any) {
    return this.zonesService.updateGroup(oldName, body.newName, req.user.siteId);
  }

  @Delete('groups/:name')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar un grupo de zona y sus barrios asociados' })
  deleteGroup(@Param('name') name: string, @Request() req: any) {
    return this.zonesService.deleteGroup(name, req.user.siteId);
  }

  @Get('grouped')
  @AllowDraftSiteSetup()
  @Permissions('zones.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Zonas agrupadas por grupo/barrio' })
  findAllGrouped(@Request() req: any) {
    return this.zonesService.findAllGrouped(req.user.siteId);
  }

  @Get('with-orders')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Listar zonas con conteo de pedidos' })
  findAllWithOrders(@Request() req: any) {
    return this.zonesService.findAllWithOrders(req.user.siteId);
  }

  @Get(':id')
  @AllowDraftSiteSetup()
  @Permissions('zones.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Obtener zona por ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.zonesService.findOne(id, req.user.siteId);
  }

  @Post('seed-monteria')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cargar barrios de Montería' })
  seedMonteria(@Request() req: any) {
    return this.zonesService.seedMonteriaBarrios(req.user.siteId);
  }

  @Post()
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear zona / barrio' })
  create(@Body() body: any, @Request() req: any) {
    return this.zonesService.create(body, req.user.siteId);
  }

  @Put(':id')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar zona' })
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.zonesService.update(id, body, req.user.siteId);
  }

  @Delete(':id')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Desactivar zona' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.zonesService.remove(id, req.user.siteId);
  }

  @Delete()
  @Roles('SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar todos los barrios (Delivery Zones)' })
  clearAll(@Request() req: any) {
    return this.zonesService.clearAll(req.user.siteId);
  }
}
