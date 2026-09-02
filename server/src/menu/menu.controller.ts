import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CreateCategoryDto, UpdateCategoryDto, CreateItemDto, UpdateItemDto } from './dto';

@ApiTags('Menu')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('menu')
export class MenuController {
  constructor(private menuService: MenuService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Listar categorías con sus items' })
  findAllCategories(@Query('includeInactive') includeInactive?: string) {
    return this.menuService.findAllCategories(includeInactive === 'true');
  }

  @Post('categories')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear categoría' })
  createCategory(@Body() body: CreateCategoryDto) {
    return this.menuService.createCategory(body);
  }

  @Put('categories/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar categoría' })
  updateCategory(@Param('id') id: string, @Body() body: UpdateCategoryDto) {
    return this.menuService.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar o desactivar categoría' })
  deleteCategory(@Param('id') id: string, @Query('force') force?: string) {
    return this.menuService.deleteCategory(id, force === 'true');
  }

  @Get('items')
  @ApiOperation({ summary: 'Listar items del menú' })
  findAllItems(@Query('categoryId') categoryId?: string) {
    return this.menuService.findAllItems({ categoryId, active: true });
  }

  @Post('items')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear item' })
  createItem(@Body() body: CreateItemDto) {
    return this.menuService.createItem(body);
  }

  @Put('items/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar item' })
  updateItem(@Param('id') id: string, @Body() body: UpdateItemDto) {
    return this.menuService.updateItem(id, body);
  }

  @Delete('items/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar o desactivar item' })
  deleteItem(@Param('id') id: string, @Query('force') force?: string) {
    return this.menuService.deleteItem(id, force === 'true');
  }

  @Post('categories/reorder')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reordenar categorías' })
  reorderCategories(@Body('ids') ids: string[]) {
    return this.menuService.reorderCategories(ids);
  }

  @Post('items/reorder')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reordenar items' })
  reorderItems(@Body('ids') ids: string[]) {
    return this.menuService.reorderItems(ids);
  }
}

