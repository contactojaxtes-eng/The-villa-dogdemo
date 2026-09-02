import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SocketGateway } from '../socket/socket.gateway';

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private socketGateway: SocketGateway,
  ) {}

  async findAllIngredients() {
    return this.prisma.ingredient.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: { recipeItems: { include: { recipe: { include: { menuItem: { select: { id: true, name: true } } } } } } },
    });
  }

  async createIngredient(data: { name: string; code?: string | null; unit?: string; purchaseUnit?: string; conversionFactor?: number; stock?: number; minStock?: number; costPerUnit?: number }) {
    if (data.stock !== undefined && data.stock < 0) throw new BadRequestException('El stock no puede ser negativo.');
    if (data.minStock !== undefined && data.minStock < 0) throw new BadRequestException('El stock mínimo no puede ser negativo.');
    if (data.costPerUnit !== undefined && data.costPerUnit < 0) throw new BadRequestException('El costo por unidad no puede ser negativo.');
    if (data.conversionFactor !== undefined && data.conversionFactor <= 0) throw new BadRequestException('El factor de conversión debe ser mayor a cero.');

    if (!data.code || !data.code.trim()) {
      throw new BadRequestException('El código del ingrediente es obligatorio.');
    }

    const formattedCode = data.code.trim().toUpperCase();
    const existing = await this.prisma.ingredient.findUnique({ where: { code: formattedCode } });
    if (existing) {
      throw new BadRequestException(`El código de ingrediente "${formattedCode}" ya está en uso.`);
    }
    data.code = formattedCode;

    const created = await this.prisma.ingredient.create({ data });
    this.socketGateway.server.emit('inventoryChanged');
    return created;
  }

  async updateIngredient(id: string, data: Partial<{ name: string; code: string | null; unit: string; purchaseUnit: string | null; conversionFactor: number; stock: number; minStock: number; costPerUnit: number; active: boolean }>) {
    await this.findIngredient(id);
    if (data.stock !== undefined && data.stock < 0) throw new BadRequestException('El stock no puede ser negativo.');
    if (data.minStock !== undefined && data.minStock < 0) throw new BadRequestException('El stock mínimo no puede ser negativo.');
    if (data.costPerUnit !== undefined && data.costPerUnit < 0) throw new BadRequestException('El costo por unidad no puede ser negativo.');
    if (data.conversionFactor !== undefined && data.conversionFactor <= 0) throw new BadRequestException('El factor de conversión debe ser mayor a cero.');

    if (data.code !== undefined) {
      if (!data.code || !data.code.trim()) {
        throw new BadRequestException('El código del ingrediente es obligatorio.');
      }
      const formattedCode = data.code.trim().toUpperCase();
      const existing = await this.prisma.ingredient.findUnique({ where: { code: formattedCode } });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`El código de ingrediente "${formattedCode}" ya está en uso.`);
      }
      data.code = formattedCode;
    }

    const updated = await this.prisma.ingredient.update({ where: { id }, data });
    this.socketGateway.server.emit('inventoryChanged');
    return updated;
  }

  async findIngredient(id: string) {
    const ingredient = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!ingredient) throw new NotFoundException('Ingrediente no encontrado');
    return ingredient;
  }

  async adjustStock(id: string, quantity: number, type: 'IN' | 'OUT' | 'ADJUST', notes?: string, userId?: string) {
    if (quantity < 0) {
      throw new BadRequestException('La cantidad para ajustar inventario no puede ser negativa.');
    }
    if ((type === 'IN' || type === 'OUT') && quantity === 0) {
      throw new BadRequestException('La cantidad para sumar o restar inventario debe ser mayor a cero.');
    }

    const ingredient = await this.findIngredient(id);
    const stockBefore = ingredient.stock;
    let stockAfter: number;

    if (type === 'IN') stockAfter = stockBefore + quantity;
    else if (type === 'OUT') stockAfter = stockBefore - quantity;
    else stockAfter = quantity;

    if (stockAfter < 0) throw new BadRequestException(`Stock insuficiente de ${ingredient.name}`);

    const [updated] = await this.prisma.$transaction([
      this.prisma.ingredient.update({ where: { id }, data: { stock: stockAfter } }),
      this.prisma.stockMovement.create({
        data: { ingredientId: id, type, quantity: Math.abs(quantity), stockBefore, stockAfter, notes, userId },
      }),
    ]);

    this.socketGateway.server.emit('inventoryChanged');

    if (stockBefore > ingredient.minStock && stockAfter <= ingredient.minStock) {
      this.mailService.sendLowStockAlert(ingredient.name, stockAfter, ingredient.minStock, ingredient.unit);
    }

    return updated;
  }

  async getLowStock() {
    const ingredients = await this.prisma.ingredient.findMany({ where: { active: true } });
    return ingredients.filter(i => i.stock <= i.minStock);
  }

  async getMovements(params: { ingredientId?: string; limit?: number }) {
    return this.prisma.stockMovement.findMany({
      where: params.ingredientId ? { ingredientId: params.ingredientId } : {},
      include: { ingredient: { select: { name: true, unit: true } }, order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50,
    });
  }

  async getRecipe(menuItemId: string) {
    return this.prisma.recipe.findUnique({
      where: { menuItemId },
      include: { items: { include: { ingredient: true } }, menuItem: { select: { id: true, name: true, price: true } } },
    });
  }

  async upsertRecipe(menuItemId: string, items: { ingredientId: string; quantity: number; wastePercentage?: number; unit?: string }[]) {
    const menuItem = await this.prisma.menuItem.findUnique({ where: { id: menuItemId } });
    if (!menuItem) throw new NotFoundException('Producto no encontrado');

    const recipe = await this.prisma.recipe.upsert({
      where: { menuItemId },
      create: { menuItemId, items: { create: items } },
      update: {
        items: {
          deleteMany: {},
          create: items,
        },
      },
      include: { items: { include: { ingredient: true } }, menuItem: true },
    });
    this.socketGateway.server.emit('inventoryChanged');
    return recipe;
  }

  private convertUnit(quantity: number, fromUnit: string | null | undefined, toUnit: string): number {
    if (!fromUnit || !toUnit || fromUnit.toLowerCase() === toUnit.toLowerCase()) {
      return quantity;
    }
    const from = fromUnit.toLowerCase().trim();
    const to = toUnit.toLowerCase().trim();

    // Weight conversion: kg <-> g
    if (from === 'kg' && to === 'g') return quantity * 1000;
    if (from === 'g' && to === 'kg') return quantity / 1000;

    // Volume conversion: l <-> ml
    if (from === 'l' && to === 'ml') return quantity * 1000;
    if (from === 'ml' && to === 'l') return quantity / 1000;

    return quantity;
  }

  async deductForOrder(orderId: string, items: { menuItemId: string; quantity: number }[]) {
    for (const item of items) {
      const recipe = await this.prisma.recipe.findUnique({
        where: { menuItemId: item.menuItemId },
        include: { items: { include: { ingredient: true } } },
      });
      if (!recipe) continue;

      for (const ri of recipe.items) {
        const baseQty = this.convertUnit(ri.quantity, ri.unit || ri.ingredient.unit, ri.ingredient.unit);
        const wasteFactor = 1 - (ri.wastePercentage || 0) / 100;
        const grossQuantity = baseQty / (wasteFactor > 0 ? wasteFactor : 1);
        const needed = grossQuantity * item.quantity;
        const ingredient = ri.ingredient;
        const stockBefore = ingredient.stock;
        const stockAfter = stockBefore - needed;

        await this.prisma.ingredient.update({
          where: { id: ingredient.id },
          data: { stock: stockAfter },
        });
        await this.prisma.stockMovement.create({
          data: {
            ingredientId: ingredient.id,
            orderId,
            type: 'SALE',
            quantity: needed,
            stockBefore,
            stockAfter,
            notes: `Venta pedido (Merma: ${ri.wastePercentage || 0}%, Medida receta: ${ri.unit || ri.ingredient.unit})`,
          },
        });
        if (stockBefore > ingredient.minStock && stockAfter <= ingredient.minStock) {
          this.mailService.sendLowStockAlert(ingredient.name, stockAfter, ingredient.minStock, ingredient.unit);
        }
      }
    }
  }

  async deleteIngredient(id: string) {
    await this.findIngredient(id);
    return this.prisma.ingredient.update({ where: { id }, data: { active: false } });
  }

  async restoreForOrder(orderId: string) {
    const movements = await this.prisma.stockMovement.findMany({
      where: { orderId, type: 'SALE' },
      include: { ingredient: true },
    });

    for (const mov of movements) {
      const stockBefore = mov.ingredient.stock;
      const stockAfter = stockBefore + mov.quantity;
      await this.prisma.ingredient.update({
        where: { id: mov.ingredientId },
        data: { stock: stockAfter },
      });
      await this.prisma.stockMovement.create({
        data: {
          ingredientId: mov.ingredientId,
          orderId,
          type: 'RESTORE',
          quantity: mov.quantity,
          stockBefore,
          stockAfter,
          notes: 'Restauración por cancelación',
        },
      });
    }
  }

  // --- Suppliers CRUD ---
  async findAllSuppliers() {
    return this.prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSupplier(data: { name: string; nit?: string; phone?: string; address?: string }) {
    return this.prisma.supplier.create({ data });
  }

  async updateSupplier(id: string, data: Partial<{ name: string; nit: string; phone: string; address: string; active: boolean }>) {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async deleteSupplier(id: string) {
    return this.prisma.supplier.update({ where: { id }, data: { active: false } });
  }

  // --- Purchases ---
  async findAllPurchases() {
    return this.prisma.purchase.findMany({
      include: {
        supplier: { select: { name: true } },
        items: { include: { ingredient: { select: { name: true, unit: true } } } },
      },
      orderBy: { purchaseDate: 'desc' },
    });
  }

  async createPurchase(
    data: {
      supplierId: string;
      invoiceNumber: string;
      purchaseDate?: string;
      notes?: string;
      items: { ingredientId: string; quantity: number; unitCost: number }[];
    },
    userId?: string,
  ) {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('La compra debe tener al menos un ítem.');
    }
    for (const item of data.items) {
      if (item.quantity <= 0) {
        throw new BadRequestException('La cantidad comprada de cada ingrediente debe ser mayor a cero.');
      }
      if (item.unitCost < 0) {
        throw new BadRequestException('El costo unitario del ingrediente no puede ser negativo.');
      }
    }
    const total = data.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Purchase header
      const purchase = await tx.purchase.create({
        data: {
          supplierId: data.supplierId,
          invoiceNumber: data.invoiceNumber,
          purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : new Date(),
          notes: data.notes,
          total,
        },
      });

      // 2. Process each item
      for (const item of data.items) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: item.ingredientId } });
        if (!ingredient) throw new NotFoundException(`Ingrediente con ID ${item.ingredientId} no encontrado`);

        const factor = ingredient.conversionFactor || 1;
        const baseQuantity = item.quantity * factor;
        const baseUnitCost = item.unitCost / factor;

        const currentStock = ingredient.stock;
        const currentCost = ingredient.costPerUnit;

        const newStock = currentStock + baseQuantity;
        
        // Costo Promedio Ponderado en base a unidades base
        let newCost = currentCost;
        if (newStock > 0) {
          newCost = ((currentStock * currentCost) + (baseQuantity * baseUnitCost)) / newStock;
        } else {
          newCost = baseUnitCost;
        }

        // 2a. Update Ingredient stock and cost (base unit)
        await tx.ingredient.update({
          where: { id: item.ingredientId },
          data: {
            stock: newStock,
            costPerUnit: Math.max(0, newCost),
          },
        });

        // 2b. Log StockMovement (in base units)
        const unitName = ingredient.purchaseUnit || ingredient.unit;
        await tx.stockMovement.create({
          data: {
            ingredientId: item.ingredientId,
            type: 'PURCHASE',
            quantity: baseQuantity,
            stockBefore: currentStock,
            stockAfter: newStock,
            notes: `Compra Factura N° ${data.invoiceNumber} (${item.quantity} ${unitName})`,
            userId,
          },
        });

        // 2c. Create PurchaseItem detail (stores original invoice quantity/cost)
        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            ingredientId: item.ingredientId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            totalCost: item.quantity * item.unitCost,
          },
        });
      }

      this.socketGateway.server.emit('inventoryChanged');
      return purchase;
    });
  }
}
