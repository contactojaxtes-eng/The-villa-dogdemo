import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePublicSite } from '../common/public-site';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

/**
 * Controlador PÚBLICO del menú (sin autenticación).
 * Solo expone lectura de categorías, items activos e información pública.
 */
@ApiTags('Public Menu')
@Controller('public/menu')
export class PublicMenuController {
  constructor(
    private menuService: MenuService,
    private prisma: PrismaService,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: 'Listar categorías públicas con items activos para domicilios' })
  async findAllCategories(@Query('site') siteCode?: string, @Req() req?: any) {
    const site = await resolvePublicSite(this.prisma, siteCode);
    if (req) req.trafficSiteId = site.id;
    return this.menuService.findAllCategories(false, true, site.id);
  }

  @Get('info')
  @ApiOperation({ summary: 'Obtener información pública del restaurante' })
  async getPublicInfo(@Query('site') siteCode?: string, @Req() req?: any) {
    const site = await resolvePublicSite(this.prisma, siteCode);
    if (req) req.trafficSiteId = site.id;
    let phone = String(
      site.whatsappAccount?.active
        ? site.whatsappAccount.displayPhoneNumber || site.phone || ''
        : site.phone || '',
    ).replace(/\D/g, '');

    if (!phone && site.id === DEFAULT_SITE_ID) {
      const setting = await this.prisma.appSetting.findUnique({
        where: { key: 'whatsapp_business_phone' },
      });
      phone = String(setting?.value || '573003229261').replace(/\D/g, '');
    }
    return {
      site: {
        id: site.id,
        code: site.code,
        name: site.name,
        address: site.address,
      },
      whatsappPhone: phone,
    };
  }
}
