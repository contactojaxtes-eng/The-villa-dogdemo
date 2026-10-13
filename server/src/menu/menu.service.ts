import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { SocketGateway } from '../socket/socket.gateway';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateItemDto,
  UpdateItemDto,
} from './dto';
import { PublicMenuGateway } from './public-menu.gateway';
import { buildMessagingMenuText } from './menu-text';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@Injectable()
export class MenuService implements OnModuleInit {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private socketGateway: SocketGateway,
    @Optional() private publicMenuGateway?: PublicMenuGateway,
  ) {}

  private resolveSiteId(siteId?: string | null) {
    return String(siteId || DEFAULT_SITE_ID).trim() || DEFAULT_SITE_ID;
  }

  private async findCategory(id: string, siteId: string) {
    const model: any = this.prisma.menuCategory as any;
    if (model.findFirst) return model.findFirst({ where: { id, siteId } });
    const category = await model.findUnique({ where: { id } });
    return category?.siteId && category.siteId !== siteId ? null : category;
  }

  private async findItem(id: string, siteId: string, include?: any) {
    const model: any = this.prisma.menuItem as any;
    if (model.findFirst) {
      return model.findFirst({ where: { id, siteId }, ...(include ? { include } : {}) });
    }
    const item = await model.findUnique({ where: { id }, ...(include ? { include } : {}) });
    return item?.siteId && item.siteId !== siteId ? null : item;
  }

  private async findItemByCode(code: string, siteId: string) {
    const model: any = this.prisma.menuItem as any;
    if (model.findFirst) return model.findFirst({ where: { siteId, code } });
    return model.findUnique({ where: { code } });
  }

  async onModuleInit() {
    try {
      const siteModel = (this.prisma as any).site;
      if (siteModel?.findMany) {
        const sites = await siteModel.findMany({
          where: { active: true, organization: { active: true } },
          select: { id: true },
        });
        for (const site of sites || []) await this.syncWhatsappMenuText(String(site.id));
      } else {
        await this.syncWhatsappMenuText(DEFAULT_SITE_ID);
      }
    } catch (error) {
      this.logger.warn('No se pudo sincronizar la carta de WhatsApp al iniciar', error);
    }
  }

  async findAllCategories(
    includeInactive = false,
    onlyDelivery = false,
    siteId = DEFAULT_SITE_ID,
  ) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    const key = `menu_categories_${resolvedSiteId}_inactive_${includeInactive}_delivery_${onlyDelivery}`;
    return this.cache.getOrSet(
      key,
      async () => {
        const whereCategory: any = { siteId: resolvedSiteId };
        if (!includeInactive) whereCategory.active = true;
        const whereItems: any = includeInactive
          ? { siteId: resolvedSiteId, code: { not: null } }
          : { siteId: resolvedSiteId, active: true, code: { not: null } };
        if (onlyDelivery) whereItems.availableForDelivery = { not: false };
        return this.prisma.menuCategory.findMany({
          where: whereCategory,
          include: {
            items: {
              where: whereItems,
              include: {
                recipe: { include: { items: { include: { ingredient: true } } } },
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: { sortOrder: 'asc' },
        });
      },
      300_000,
    );
  }

  async findAllItems(
    params: { categoryId?: string; active?: boolean },
    siteId = DEFAULT_SITE_ID,
  ) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    const key = `menu_items_${resolvedSiteId}_${params.categoryId || 'all'}_${params.active ?? 'all'}`;
    return this.cache.getOrSet(
      key,
      async () => {
        const where: any = { siteId: resolvedSiteId, code: { not: null } };
        if (params.categoryId) where.categoryId = params.categoryId;
        if (params.active !== undefined) where.active = params.active;
        return this.prisma.menuItem.findMany({
          where,
          include: { category: true },
          orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        });
      },
      300_000,
    );
  }

  private async getAutoMenuSyncSiteIds(): Promise<string[]> {
    const siteModel = (this.prisma as any).site;
    const siteSettingModel = (this.prisma as any).siteSetting;
    if (!this.socketGateway.server || !siteModel?.findMany || !siteSettingModel?.findMany) {
      return [DEFAULT_SITE_ID];
    }
    try {
      const sites = await siteModel.findMany({
        where: { active: true, organization: { active: true } },
        select: { id: true },
      });
      const ids = Array.from(
        new Set<string>(
          (sites || [])
            .map((site: any) => String(site?.id || '').trim())
            .filter(Boolean),
        ),
      );
      const secondary = ids.filter((id) => id !== DEFAULT_SITE_ID);
      if (!secondary.length) return [DEFAULT_SITE_ID];
      const customRows = await siteSettingModel.findMany({
        where: { siteId: { in: secondary }, key: 'chatbot_menu_text_custom' },
        select: { siteId: true, value: true },
      });
      const customBySite = new Map<string, string>(
        (customRows || []).map((row: any) => [
          String(row?.siteId || ''),
          String(row?.value || '').trim().toLowerCase(),
        ]),
      );
      return [DEFAULT_SITE_ID, ...secondary.filter((id) => customBySite.get(id) !== 'true')];
    } catch (error) {
      this.logger.warn('No se pudieron determinar las sedes para sincronizar la carta', error);
      return [DEFAULT_SITE_ID];
    }
  }

  private async syncOneWhatsappMenuText(siteId: string) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    const siteSettingModel = (this.prisma as any).siteSetting;
    let custom = false;
    if (resolvedSiteId === DEFAULT_SITE_ID) {
      const row = await this.prisma.appSetting.findUnique({
        where: { key: 'chatbot_menu_text_custom' },
      });
      custom = String(row?.value || '').trim().toLowerCase() === 'true';
    } else if (siteSettingModel?.findUnique) {
      const row = await siteSettingModel.findUnique({
        where: { siteId_key: { siteId: resolvedSiteId, key: 'chatbot_menu_text_custom' } },
        select: { value: true },
      });
      custom = String(row?.value || '').trim().toLowerCase() === 'true';
    }
    if (custom) return null;

    const categories = await this.prisma.menuCategory.findMany({
      where: { siteId: resolvedSiteId, active: true },
      include: {
        items: {
          where: {
            siteId: resolvedSiteId,
            active: true,
            availableForDelivery: { not: false },
            code: { not: null },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { name: true, price: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const menuText = buildMessagingMenuText(categories);

    if (resolvedSiteId === DEFAULT_SITE_ID) {
      await this.prisma.appSetting.upsert({
        where: { key: 'chatbot_menu_text' },
        create: { key: 'chatbot_menu_text', value: menuText },
        update: { value: menuText },
      });
      this.socketGateway.emitWhatsApp('whatsappSettingsUpdated', { menuText });
    } else if (siteSettingModel?.upsert) {
      if (siteSettingModel.findUnique) {
        const latest = await siteSettingModel.findUnique({
          where: { siteId_key: { siteId: resolvedSiteId, key: 'chatbot_menu_text_custom' } },
          select: { value: true },
        });
        if (String(latest?.value || '').trim().toLowerCase() === 'true') return null;
      }
      await siteSettingModel.upsert({
        where: { siteId_key: { siteId: resolvedSiteId, key: 'chatbot_menu_text' } },
        create: { siteId: resolvedSiteId, key: 'chatbot_menu_text', value: menuText },
        update: { value: menuText },
      });
      this.socketGateway.emitWhatsApp(
        'whatsappSettingsUpdated',
        { menuText, siteId: resolvedSiteId },
        resolvedSiteId,
      );
    }
    return menuText;
  }

  private async syncWhatsappMenuText(siteId?: string) {
    if (siteId) return this.syncOneWhatsappMenuText(siteId);
    const siteIds = await this.getAutoMenuSyncSiteIds();
    const results: Record<string, string | null> = {};
    for (const id of siteIds) results[id] = await this.syncOneWhatsappMenuText(id);
    return results;
  }

  private async invalidateCache(siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    this.cache.invalidateByPrefix(`menu_${resolvedSiteId}_`);
    try {
      await this.syncWhatsappMenuText(resolvedSiteId);
    } catch (error) {
      this.logger.warn(`No se pudo actualizar la carta de WhatsApp para la sede ${resolvedSiteId}`, error);
    }
    this.socketGateway.emitToSite?.(resolvedSiteId, 'menuUpdated', { siteId: resolvedSiteId });
    this.publicMenuGateway?.emitMenuUpdated(resolvedSiteId);
  }

  async createCategory(data: CreateCategoryDto, siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    let sortOrder = data.sortOrder;
    if (sortOrder === undefined) {
      const maxOrder = await this.prisma.menuCategory.aggregate({
        where: { siteId: resolvedSiteId },
        _max: { sortOrder: true },
      });
      sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;
    }
    const result = await this.prisma.menuCategory.create({
      data: { ...data, siteId: resolvedSiteId, sortOrder },
    });
    await this.invalidateCache(resolvedSiteId);
    return result;
  }

  async updateCategory(id: string, data: UpdateCategoryDto, siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    if (!(await this.findCategory(id, resolvedSiteId))) {
      throw new NotFoundException('Categoría no encontrada');
    }
    const result = await this.prisma.menuCategory.update({ where: { id }, data });
    await this.invalidateCache(resolvedSiteId);
    return result;
  }

  async deleteCategory(id: string, force = false, siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    if (!(await this.findCategory(id, resolvedSiteId))) {
      throw new NotFoundException('Categoría no encontrada');
    }
    const items = await this.prisma.menuItem.findMany({
      where: { siteId: resolvedSiteId, categoryId: id },
      include: { _count: { select: { orderItems: true } } },
    });
    for (const item of items) {
      try {
        await this.prisma.recipe.deleteMany({ where: { menuItemId: item.id } });
        await this.prisma.kitchenTicketItem.deleteMany({ where: { menuItemId: item.id } });
        if (force || item._count.orderItems === 0) {
          if (force) await this.prisma.orderItem.deleteMany({ where: { menuItemId: item.id } });
          await this.prisma.menuItem.delete({ where: { id: item.id } });
        } else {
          await this.prisma.menuItem.update({ where: { id: item.id }, data: { active: false, code: null } });
        }
      } catch {
        await this.prisma.menuItem.update({ where: { id: item.id }, data: { active: false, code: null } }).catch(() => {});
      }
    }
    const remaining = await this.prisma.menuItem.count({ where: { siteId: resolvedSiteId, categoryId: id } });
    let result: any;
    if (remaining === 0) {
      await this.prisma.menuCategory.delete({ where: { id } });
      result = { success: true, hardDeleted: true, message: 'Categoría y sus productos fueron eliminados correctamente.' };
    } else {
      await this.prisma.menuCategory.update({ where: { id }, data: { active: false } });
      result = { success: true, hardDeleted: false, message: 'La categoría fue desactivada ya que posee productos con ventas históricas asociadas.' };
    }
    await this.invalidateCache(resolvedSiteId);
    return result;
  }

  async createItem(data: CreateItemDto, siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    if (data.price < 0) throw new BadRequestException('El precio del producto no puede ser negativo.');
    if (!data.code || typeof data.code !== 'string' || !data.code.trim()) {
      throw new BadRequestException('El código del producto es obligatorio.');
    }
    if (!(await this.findCategory(data.categoryId, resolvedSiteId))) {
      throw new NotFoundException('La categoría especificada no existe en esta sede.');
    }
    const payload: any = { ...data, siteId: resolvedSiteId, code: data.code.trim().toUpperCase() };
    if (await this.findItemByCode(payload.code, resolvedSiteId)) {
      throw new ConflictException(`El código de producto "${payload.code}" ya existe en esta sede.`);
    }
    const result = await this.prisma.menuItem.create({ data: payload, include: { category: true } });
    await this.invalidateCache(resolvedSiteId);
    return result;
  }

  async updateItem(id: string, data: UpdateItemDto, siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    if (!(await this.findItem(id, resolvedSiteId))) throw new NotFoundException('Item no encontrado');
    if (data.price !== undefined && data.price < 0) throw new BadRequestException('El precio del producto no puede ser negativo.');
    if (data.categoryId && !(await this.findCategory(data.categoryId, resolvedSiteId))) {
      throw new NotFoundException('La categoría especificada no existe en esta sede.');
    }
    const payload: any = { ...data };
    if (payload.code !== undefined) {
      if (!payload.code || typeof payload.code !== 'string' || !payload.code.trim()) {
        throw new BadRequestException('El código del producto es obligatorio.');
      }
      payload.code = payload.code.trim().toUpperCase();
      const existing = await this.findItemByCode(payload.code, resolvedSiteId);
      if (existing && existing.id !== id) throw new ConflictException(`El código de producto "${payload.code}" ya existe en esta sede.`);
    }
    const result = await this.prisma.menuItem.update({ where: { id }, data: payload, include: { category: true } });
    await this.invalidateCache(resolvedSiteId);
    return result;
  }

  async deleteItem(id: string, force = false, siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    const item = await this.findItem(id, resolvedSiteId, { _count: { select: { orderItems: true, kitchenTicketItems: true } } });
    if (!item) throw new NotFoundException('Producto no encontrado');
    let result: any;
    try {
      await this.prisma.recipe.deleteMany({ where: { menuItemId: id } });
      await this.prisma.kitchenTicketItem.deleteMany({ where: { menuItemId: id } });
      if (force) {
        await this.prisma.orderItem.deleteMany({ where: { menuItemId: id } });
        await this.prisma.menuItem.delete({ where: { id } });
        result = { success: true, hardDeleted: true, message: 'Producto eliminado permanentemente de la base de datos.' };
      } else if (item._count.orderItems === 0) {
        await this.prisma.menuItem.delete({ where: { id } });
        result = { success: true, hardDeleted: true, message: 'Producto eliminado permanentemente de la base de datos.' };
      } else {
        await this.prisma.menuItem.update({ where: { id }, data: { active: false, code: null } });
        result = { success: true, hardDeleted: false, message: 'El producto fue retirado del menú (conservado en historial de ventas).' };
      }
    } catch (err: any) {
      this.logger.warn(`Fallback retiro seguro para producto ${id}: ${err?.message}`);
      await this.prisma.menuItem.update({ where: { id }, data: { active: false, code: null } });
      result = { success: true, hardDeleted: false, message: 'El producto fue retirado del menú correctamente.' };
    }
    await this.invalidateCache(resolvedSiteId);
    return result;
  }

  private async validateIdsBelongToSite(model: any, ids: string[], siteId: string, label: string) {
    const uniqueIds = [...new Set((ids || []).map(String).filter(Boolean))];
    if (uniqueIds.length !== (ids || []).length) throw new BadRequestException(`La lista de ${label} contiene identificadores repetidos o vacíos.`);
    if (!uniqueIds.length) return uniqueIds;
    const rows = await model.findMany({ where: { id: { in: uniqueIds }, siteId }, select: { id: true } });
    if (rows.length !== uniqueIds.length) throw new NotFoundException(`Uno o más ${label} no pertenecen a la sede activa.`);
    return uniqueIds;
  }

  async reorderCategories(ids: string[], siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    const validIds = await this.validateIdsBelongToSite(this.prisma.menuCategory, ids, resolvedSiteId, 'categorías');
    await this.prisma.$transaction(validIds.map((id, index) => this.prisma.menuCategory.update({ where: { id }, data: { sortOrder: index } })));
    await this.invalidateCache(resolvedSiteId);
    return { success: true };
  }

  async reorderItems(ids: string[], siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = this.resolveSiteId(siteId);
    const validIds = await this.validateIdsBelongToSite(this.prisma.menuItem, ids, resolvedSiteId, 'productos');
    await this.prisma.$transaction(validIds.map((id, index) => this.prisma.menuItem.update({ where: { id }, data: { sortOrder: index } })));
    await this.invalidateCache(resolvedSiteId);
    return { success: true };
  }
}
