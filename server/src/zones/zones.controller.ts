import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZonesService } from './zones.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Delivery Zones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('zones')
export class ZonesController {
  constructor(private zonesService: ZonesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas las zonas' })
  findAll() {
    return this.zonesService.findAll();
  }

  @Get('groups')
  @ApiOperation({ summary: 'Listar grupos de zonas' })
  getGroups() {
    return this.zonesService.getGroups();
  }

  @Post('groups')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear un nuevo grupo de zona' })
  createGroup(@Body() body: { name: string }) {
    return this.zonesService.createGroup(body.name);
  }

  @Put('groups/:oldName')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar un grupo de zona' })
  updateGroup(@Param('oldName') oldName: string, @Body() body: { newName: string }) {
    return this.zonesService.updateGroup(oldName, body.newName);
  }

  @Delete('groups/:name')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar un grupo de zona y sus barrios asociados' })
  deleteGroup(@Param('name') name: string) {
    return this.zonesService.deleteGroup(name);
  }

  @Get('grouped')
  @ApiOperation({ summary: 'Zonas agrupadas por grupo/barrio' })
  findAllGrouped() {
    return this.zonesService.findAllGrouped();
  }

  @Get('with-orders')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Listar zonas con conteo de pedidos' })
  findAllWithOrders() {
    return this.zonesService.findAllWithOrders();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener zona por ID' })
  findOne(@Param('id') id: string) {
    return this.zonesService.findOne(id);
  }

  @Post('seed-monteria')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Cargar barrios de Montería' })
  seedMonteria() {
    return this.zonesService.seedMonteriaBarrios();
  }

  @Post()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear zona / barrio' })
  create(@Body() body: any) {
    return this.zonesService.create(body);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar zona' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.zonesService.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Desactivar zona' })
  remove(@Param('id') id: string) {
    return this.zonesService.remove(id);
  }

  @Delete()
  @Roles('SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar todos los barrios (Delivery Zones)' })
  clearAll() {
    return this.zonesService.clearAll();
  }
}
