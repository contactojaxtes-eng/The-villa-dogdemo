import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async findAllCategories() {
    const otrosId = 'otros';
    const otrosExists = await this.prisma.expenseCategory.findUnique({ where: { id: otrosId } });
    if (!otrosExists) {
      await this.prisma.expenseCategory.create({
        data: {
          id: otrosId,
          name: 'Otros',
          description: 'Otros tipos de gastos no clasificados',
          active: true
        }
      });
    }
    return this.prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  async createCategory(data: { name: string; description?: string }) {
    return this.prisma.expenseCategory.create({ data });
  }

  async updateCategory(id: string, data: { name?: string; description?: string; active?: boolean }) {
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.expenseCategory.update({ where: { id }, data });
  }

  async findAll(params: { categoryId?: string; userId?: string; startDate?: string; endDate?: string }) {
    const where: any = {};
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.userId) where.userId = params.userId;
    if (params.startDate || params.endDate) {
      where.date = {};
      if (params.startDate) where.date.gte = new Date(params.startDate);
      if (params.endDate) where.date.lte = new Date(params.endDate);
    }
    return this.prisma.expense.findMany({
      where,
      include: { category: true, user: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: { category: true, user: { select: { id: true, name: true } } },
    });
    if (!expense) throw new NotFoundException('Gasto no encontrado');
    return expense;
  }

  async create(data: { description: string; amount: number; categoryId: string; userId: string; date?: string; receiptImage?: string; ingredientId?: string; quantity?: number }) {
    if (data.amount <= 0) {
      throw new BadRequestException('El monto del gasto debe ser mayor a cero.');
    }
    if (data.ingredientId && data.quantity !== undefined && data.quantity <= 0) {
      throw new BadRequestException('La cantidad del ingrediente debe ser mayor a cero.');
    }
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          description: data.description,
          amount: data.amount,
          categoryId: data.categoryId,
          userId: data.userId,
          date: data.date ? new Date(data.date) : new Date(),
          receiptImage: data.receiptImage,
        },
        include: { category: true, user: { select: { id: true, name: true } } },
      });

      if (data.ingredientId && data.quantity) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: data.ingredientId } });
        if (!ingredient) throw new NotFoundException('Ingrediente no encontrado');

        const stockBefore = ingredient.stock;
        const stockAfter = stockBefore + data.quantity;

        // Recalcular costo promedio ponderado
        const oldVal = stockBefore * ingredient.costPerUnit;
        const newVal = oldVal + data.amount;
        const costPerUnit = stockAfter > 0 ? (newVal / stockAfter) : (data.amount / data.quantity);

        await tx.ingredient.update({
          where: { id: data.ingredientId },
          data: { stock: stockAfter, costPerUnit },
        });

        await tx.stockMovement.create({
          data: {
            ingredientId: data.ingredientId,
            type: 'PURCHASE',
            quantity: data.quantity,
            stockBefore,
            stockAfter,
            notes: `Vinculado a Gasto: ${data.description}`,
            userId: data.userId,
          },
        });
      }

      return expense;
    });
  }

  async update(id: string, data: { description?: string; amount?: number; categoryId?: string; date?: string; receiptImage?: string }) {
    await this.findOne(id);
    return this.prisma.expense.update({
      where: { id },
      data: { ...data, date: data.date ? new Date(data.date) : undefined },
      include: { category: true, user: { select: { id: true, name: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.expense.delete({ where: { id } });
  }

  async getSummary(params: { startDate?: string; endDate?: string }) {
    const where: any = {};
    if (params.startDate || params.endDate) {
      where.date = {};
      if (params.startDate) where.date.gte = new Date(params.startDate);
      if (params.endDate) where.date.lte = new Date(params.endDate);
    }
    const expenses = await this.prisma.expense.findMany({ where, include: { category: true } });
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const byCategory: Record<string, { name: string; total: number; count: number }> = {};
    for (const e of expenses) {
      const catName = e.category.name;
      if (!byCategory[catName]) byCategory[catName] = { name: catName, total: 0, count: 0 };
      byCategory[catName].total += e.amount;
      byCategory[catName].count++;
    }
    return { total, totalItems: expenses.length, byCategory: Object.values(byCategory) };
  }
}
