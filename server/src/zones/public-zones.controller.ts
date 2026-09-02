import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZonesService } from './zones.service';

/**
 * Controlador PUBLICO de zonas (sin autenticacion).
 * Solo expone lectura de zonas activas para el menu digital.
 */
@ApiTags('Public Zones')
@Controller('public/zones')
export class PublicZonesController {
  constructor(private zonesService: ZonesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar zonas publicas con precios de domicilio' })
  findAll() {
    return this.zonesService.findAll();
  }
}
