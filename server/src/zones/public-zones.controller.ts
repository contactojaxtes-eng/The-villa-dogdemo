import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZonesService } from './zones.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePublicSite } from '../common/public-site';

/**
 * Controlador PUBLICO de zonas (sin autenticacion).
 * Solo expone lectura de zonas activas para el menu digital.
 */
@ApiTags('Public Zones')
@Controller('public/zones')
export class PublicZonesController {
  constructor(
    private zonesService: ZonesService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar zonas publicas con precios de domicilio' })
  async findAll(@Query('site') siteCode?: string, @Req() req?: any) {
    const site = await resolvePublicSite(this.prisma, siteCode);
    if (req) req.trafficSiteId = site.id;
    return this.zonesService.findAll(site.id);
  }
}
