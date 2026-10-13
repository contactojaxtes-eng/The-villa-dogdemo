import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CreateCategoryDto, UpdateCategoryDto, CreateItemDto, UpdateItemDto } from './dto';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';

@ApiTags('Menu')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('menu')
export class MenuController {
  constructor(private menuService: MenuService) {}

  @Get('categories')
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Listar categorías con sus items' })
  findAllCategories(@Query('includeInactive') includeInactive?: string, @Request() req?: any) {
    return this.menuService.findAllCategories(includeInactive === 'true', false, req?.user?.siteId);
  }

  @Post('categories')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear categoría' })
  createCategory(@Body() body: CreateCategoryDto, @Request() req: any) {
    return this.menuService.createCategory(body, req?.user?.siteId);
  }

  @Put('categories/:id')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar categoría' })
  updateCategory(@Param('id') id: string, @Body() body: UpdateCategoryDto, @Request() req: any) {
    return this.menuService.updateCategory(id, body, req?.user?.siteId);
  }

  @Delete('categories/:id')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar o desactivar categoría' })
  deleteCategory(@Param('id') id: string, @Query('force') force?: string, @Request() req?: any) {
    return this.menuService.deleteCategory(id, force === 'true', req?.user?.siteId);
  }

  @Get('items')
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Listar items del menú' })
  findAllItems(@Query('categoryId') categoryId?: string, @Request() req?: any) {
    return this.menuService.findAllItems({ categoryId, active: true }, req?.user?.siteId);
  }

  @Post('items')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear item' })
  createItem(@Body() body: CreateItemDto, @Request() req: any) {
    return this.menuService.createItem(body, req?.user?.siteId);
  }

  @Put('items/:id')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar item' })
  updateItem(@Param('id') id: string, @Body() body: UpdateItemDto, @Request() req: any) {
    return this.menuService.updateItem(id, body, req?.user?.siteId);
  }

  @Delete('items/:id')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar o desactivar item' })
  deleteItem(@Param('id') id: string, @Query('force') force?: string, @Request() req?: any) {
    return this.menuService.deleteItem(id, force === 'true', req?.user?.siteId);
  }

  @Post('categories/reorder')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reordenar categorías' })
  reorderCategories(@Body('ids') ids: string[], @Request() req: any) {
    return this.menuService.reorderCategories(ids, req?.user?.siteId);
  }

  @Post('items/reorder')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reordenar items' })
  reorderItems(@Body('ids') ids: string[], @Request() req: any) {
    return this.menuService.reorderItems(ids, req?.user?.siteId);
  }
}

