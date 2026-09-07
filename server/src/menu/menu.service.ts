import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { SocketGateway } from '../socket/socket.gateway';
import { CreateCategoryDto, UpdateCategoryDto, CreateItemDto, UpdateItemDto } from './dto';
import { PublicMenuGateway } from './public-menu.gateway';
import { buildMessagingMenuText } from './menu-text';

@Injectable()
export class MenuService implements OnModuleInit {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private socketGateway: SocketGateway,
    @Optional() private publicMenuGateway?: PublicMenuGateway,
  ) {}

  async onModuleInit() {
    try {
      await this.syncWhatsappMenuText();
    } catch (error) {
      this.logger.warn('No se pudo sincronizar la carta de WhatsApp al iniciar', error);
    }
  }

  async findAllCategories(includeInactive = false) {
    const key = `menu_categories_inactive_${includeInactive}`;
    return this.cache.getOrSet(key, async () => {
      const whereCategory = includeInactive ? {} : { active: true };
      const whereItems = includeInactive ? {} : { active: true };
      return this.prisma.menuCategory.findMany({
        where: whereCategory,
        include: {
          items: {
            where: whereItems,
            include: {
              recipe: {
                include: {
                  items: {
                    include: {
                      ingredient: true,
                    },
                  },
                },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      });
    }, 300_000); // 5 min
  }

  async findAllItems(params: { categoryId?: string; active?: boolean }) {
    const key = `menu_items_${params.categoryId || 'all'}_${params.active ?? 'all'}`;
    return this.cache.getOrSet(key, async () => {
      const where: any = {};
      if (params.categoryId) where.categoryId = params.categoryId;
      if (params.active !== undefined) where.active = params.active;
      return this.prisma.menuItem.findMany({
        where,
        include: { category: true },
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { sortOrder: 'asc' },
        ],
      });
    }, 300_000); // 5 min
  }

  private async syncWhatsappMenuText() {
    const categories = await this.prisma.menuCategory.findMany({
      where: { active: true },
      include: {
        items: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { name: true, price: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const menuText = buildMessagingMenuText(categories);
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_menu_text' },
      create: { key: 'chatbot_menu_text', value: menuText },
      update: { value: menuText },
    });
    if (this.socketGateway.server) {
      this.socketGateway.emitWhatsApp('whatsappSettingsUpdated', { menuText });
    }
    return menuText;
  }

  private async invalidateCache() {
    this.cache.invalidateByPrefix('menu_');
    try {
      await this.syncWhatsappMenuText();
    } catch (error) {
      // El catálogo ya se guardó; una falla puntual al actualizar la vista de
      // WhatsApp no debe hacer fallar la creación o edición del producto.
      this.logger.warn('No se pudo actualizar el texto guardado de la carta de WhatsApp', error);
    }
    this.socketGateway.server?.emit('menuUpdated');
    this.publicMenuGateway?.emitMenuUpdated();
  }

  async createCategory(data: CreateCategoryDto) {
    if (data.sortOrder === undefined) {
      const maxOrder = await this.prisma.menuCategory.aggregate({ _max: { sortOrder: true } });
      data.sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;
    }
    const result = await this.prisma.menuCategory.create({ data });
    await this.invalidateCache();
    return result;
  }

  async updateCategory(id: string, data: UpdateCategoryDto) {
    const cat = await this.prisma.menuCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    const result = await this.prisma.menuCategory.update({ where: { id }, data });
    await this.invalidateCache();
    return result;
  }

  async deleteCategory(id: string, force = false) {
    const cat = await this.prisma.menuCategory.findUnique({
      where: { id },
    });
    if (!cat) throw new NotFoundException('Categoría no encontrada');

    // Obtener todos los productos pertenecientes a la categoría
    const items = await this.prisma.menuItem.findMany({
      where: { categoryId: id },
      include: { _count: { select: { orderItems: true } } },
    });

    for (const item of items) {
      // 1. Eliminar recetas asociadas al producto
      await this.prisma.recipe.deleteMany({ where: { menuItemId: item.id } });

      // 2. Si el producto no tiene ventas registradas, eliminarlo físicamente
      if (item._count.orderItems === 0) {
        await this.prisma.menuItem.delete({ where: { id: item.id } });
      } else {
        // Si tiene ventas históricas, desactivarlo y liberar el código único
        await this.prisma.menuItem.update({
          where: { id: item.id },
          data: { active: false, code: null },
        });
      }
    }

    // Verificar si aún quedan productos asociados en DB
    const remainingItemsCount = await this.prisma.menuItem.count({ where: { categoryId: id } });

    let result;
    if (remainingItemsCount === 0) {
      await this.prisma.menuCategory.delete({ where: { id } });
      result = { success: true, hardDeleted: true, message: 'Categoría y sus productos fueron eliminados correctamente.' };
    } else {
      await this.prisma.menuCategory.update({ where: { id }, data: { active: false } });
      result = { success: true, hardDeleted: false, message: 'La categoría fue desactivada ya que posee productos con ventas históricas asociadas.' };
    }

    await this.invalidateCache();
    return result;
  }

  async createItem(data: CreateItemDto) {
    if (data.price < 0) {
      throw new BadRequestException('El precio del producto no puede ser negativo.');
    }
    if (!data.code || typeof data.code !== 'string' || !data.code.trim()) {
      throw new BadRequestException('El código del producto es obligatorio.');
    }
    const cat = await this.prisma.menuCategory.findUnique({ where: { id: data.categoryId } });
    if (!cat) throw new NotFoundException('La categoría especificada no existe.');

    const payload: any = { ...data };
    payload.code = payload.code.trim().toUpperCase();

    const existing = await this.prisma.menuItem.findUnique({ where: { code: payload.code } });
    if (existing) {
      throw new ConflictException(`El código de producto "${payload.code}" ya existe.`);
    }

    const result = await this.prisma.menuItem.create({ data: payload, include: { category: true } });
    await this.invalidateCache();
    return result;
  }

  async updateItem(id: string, data: UpdateItemDto) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item no encontrado');
    if (data.price !== undefined && data.price < 0) {
      throw new BadRequestException('El precio del producto no puede ser negativo.');
    }
    if (data.categoryId) {
      const cat = await this.prisma.menuCategory.findUnique({ where: { id: data.categoryId } });
      if (!cat) throw new NotFoundException('La categoría especificada no existe.');
    }

    const payload: any = { ...data };
    if (payload.code !== undefined) {
      if (!payload.code || typeof payload.code !== 'string' || !payload.code.trim()) {
        throw new BadRequestException('El código del producto es obligatorio.');
      }
      payload.code = payload.code.trim().toUpperCase();
      const existing = await this.prisma.menuItem.findUnique({ where: { code: payload.code } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`El código de producto "${payload.code}" ya existe.`);
      }
    }

    const result = await this.prisma.menuItem.update({ where: { id }, data: payload, include: { category: true } });
    await this.invalidateCache();
    return result;
  }

  async deleteItem(id: string, force = false) {
    const item = await this.prisma.menuItem.findUnique({
      where: { id },
      include: { _count: { select: { orderItems: true } } },
    });
    if (!item) throw new NotFoundException('Producto no encontrado');

    let result;
    if (force || item._count.orderItems === 0) {
      // 1. Eliminar receta vinculada si existe
      await this.prisma.recipe.deleteMany({ where: { menuItemId: id } });
      // 2. Eliminar producto físicamente
      await this.prisma.menuItem.delete({ where: { id } });
      result = { success: true, hardDeleted: true, message: 'Producto eliminado permanentemente de la base de datos.' };
    } else {
      await this.prisma.menuItem.update({
        where: { id },
        data: { active: false, code: null },
      });
      result = { success: true, hardDeleted: false, message: 'El producto fue deshabilitado ya que posee ventas históricas asociadas.' };
    }
    await this.invalidateCache();
    return result;
  }

  async reorderCategories(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.menuCategory.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );
    await this.invalidateCache();
    return { success: true };
  }

  async reorderItems(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.menuItem.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );
    await this.invalidateCache();
    return { success: true };
  }
}

