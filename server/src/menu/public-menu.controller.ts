import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { PrismaService } from '../prisma/prisma.service';

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
  @ApiOperation({ summary: 'Listar categorías públicas con items activos' })
  findAllCategories() {
    return this.menuService.findAllCategories(false);
  }

  @Get('info')
  @ApiOperation({ summary: 'Obtener información pública del restaurante' })
  async getPublicInfo() {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: 'whatsapp_business_phone' }
    });
    const phone = setting?.value ? setting.value.replace(/\D/g, '') : '573003229261';
    return {
      whatsappPhone: phone
    };
  }
}
