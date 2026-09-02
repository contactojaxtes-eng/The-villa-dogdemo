import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async getSalesReport(startDate: string, endDate: string) {
    let start = new Date(`${startDate}T05:00:00.000-05:00`);
    let end = new Date(`${endDate}T04:59:59.999-05:00`);
    end.setDate(end.getDate() + 1);

    const shiftForDate = await this.prisma.cashClosing.findFirst({
      where: { shiftStart: { gte: new Date(`${startDate}T00:00:00.000-05:00`), lte: new Date(`${endDate}T23:59:59.999-05:00`) } },
      orderBy: { shiftStart: 'desc' },
    });

    if (shiftForDate) {
      if (shiftForDate.shiftStart < start) {
        start = shiftForDate.shiftStart;
      }
      if (shiftForDate.isOpen) {
        end = new Date();
      } else if (shiftForDate.shiftEnd && shiftForDate.shiftEnd > end) {
        end = shiftForDate.shiftEnd;
      }
    }

    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: {
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        deliveryDriver: { select: { id: true, name: true, phone: true } },
        cancelledBy: { select: { id: true, name: true } },
        zone: true,
        items: { include: { menuItem: true } },
        payment: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const deliveredOrders = orders.filter(o => o.status === 'DELIVERED');
    const cancelledOrders = orders.filter(o => o.status === 'CANCELLED');
    const pendingOrders = orders.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status));

    const totalSales = deliveredOrders.reduce((s, o) => s + o.total, 0);
    const totalTax = deliveredOrders.reduce((s, o) => s + (o.tax && o.tax > 0 ? o.tax : Math.round(o.subtotal - Math.round(o.subtotal / 1.08))), 0);
    const totalSubtotalBruto = deliveredOrders.reduce((s, o) => s + o.subtotal, 0);
    const totalSubtotal = totalSubtotalBruto - totalTax;
    const totalDeliveryFee = deliveredOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const totalCancelledSales = cancelledOrders.reduce((s, o) => s + o.total, 0);
    const totalOrders = orders.length;
    const totalTips = deliveredOrders.reduce((s, o) => s + (o.tip || 0), 0);
    const avgOrderValue = deliveredOrders.length > 0 ? totalSales / deliveredOrders.length : 0;

    const formattedOrders = orders.map(o => {
      const calcTax = o.tax && o.tax > 0 ? o.tax : Math.round(o.subtotal - Math.round(o.subtotal / 1.08));
      const calcBase = o.subtotal - calcTax;
      return {
        ...o,
        tax: calcTax,
        subtotalBase: calcBase,
      };
    });

    const byWaiter: Record<string, any> = {};
    for (const o of deliveredOrders) {
      const key = o.waiter?.name || 'Sistema / Bot';
      if (!byWaiter[key]) byWaiter[key] = { name: key, orders: 0, sales: 0, tips: 0 };
      byWaiter[key].orders++;
      byWaiter[key].sales += o.total;
      byWaiter[key].tips += (o.tip || 0);
    }

    const byDriver: Record<string, any> = {};
    for (const o of deliveredOrders) {
      if (o.deliveryDriver) {
        const key = o.deliveryDriver.name;
        if (!byDriver[key]) byDriver[key] = { name: key, phone: o.deliveryDriver.phone, deliveries: 0, fees: 0, total: 0 };
        byDriver[key].deliveries++;
        byDriver[key].fees += (o.deliveryFee || 0);
        byDriver[key].total += o.total;
      }
    }

    const byCustomer: Record<string, any> = {};
    for (const o of deliveredOrders) {
      const key = o.customerPhone || o.customerName || 'Cliente General';
      if (!byCustomer[key]) byCustomer[key] = { name: o.customerName || 'Cliente', phone: o.customerPhone || '', orders: 0, total: 0 };
      byCustomer[key].orders++;
      byCustomer[key].total += o.total;
    }

    const byPaymentMethod: Record<string, any> = {};
    for (const o of deliveredOrders) {
      const key = o.paymentMethod;
      if (!byPaymentMethod[key]) byPaymentMethod[key] = { method: key, orders: 0, total: 0 };
      byPaymentMethod[key].orders++;
      byPaymentMethod[key].total += o.total;
    }

    const topItems = new Map<string, { name: string; quantity: number; total: number }>();
    for (const o of deliveredOrders) {
      for (const item of o.items) {
        if (!item.menuItem) continue;
        const key = item.menuItem.name;
        if (!topItems.has(key)) topItems.set(key, { name: key, quantity: 0, total: 0 });
        const entry = topItems.get(key)!;
        entry.quantity += item.quantity;
        entry.total += item.totalPrice;
      }
    }

    const customerPayments = await this.prisma.customerPayment.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalAbonosCash = customerPayments.filter(p => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
    const totalAbonosTransfer = customerPayments.filter(p => p.method === 'TRANSFER').reduce((s, p) => s + p.amount, 0);
    const totalAbonos = customerPayments.reduce((s, p) => s + p.amount, 0);

    return {
      period: { start: startDate, end: endDate },
      summary: {
        totalSales,
        totalSubtotalBruto,
        totalTax,
        totalSubtotal,
        totalDeliveryFee,
        totalCancelledSales,
        totalOrders,
        deliveredOrders: deliveredOrders.length,
        cancelledOrders: cancelledOrders.length,
        pendingOrders: pendingOrders.length,
        totalTips,
        avgOrderValue,
      },
      abonosCartera: {
        total: totalAbonos,
        totalCash: totalAbonosCash,
        totalTransfer: totalAbonosTransfer,
        count: customerPayments.length,
        items: customerPayments.map(p => ({
          id: p.id,
          amount: p.amount,
          method: p.method === 'CASH' ? 'Efectivo' : 'Transferencia',
          customerName: p.customer?.name || 'Cliente',
          customerPhone: p.customer?.phone || '',
          reference: p.reference || null,
          notes: p.notes || null,
          createdAt: p.createdAt,
          confirmedBy: 'Cajero',
        })),
      },
      byWaiter: Object.values(byWaiter),
      byDriver: Object.values(byDriver),
      byCustomer: Object.values(byCustomer).sort((a, b) => b.total - a.total).slice(0, 50),
      byPaymentMethod: Object.values(byPaymentMethod),
      topItems: Array.from(topItems.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 30),
      orders: formattedOrders,
    };
  }

  async getExpensesReport(startDate: string, endDate: string) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const expenses = await this.prisma.expense.findMany({
      where: { date: { gte: start, lte: end } },
      include: { category: true, user: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    const byCategory: Record<string, any> = {};
    for (const e of expenses) {
      const key = e.category.name;
      if (!byCategory[key]) byCategory[key] = { category: key, total: 0, count: 0 };
      byCategory[key].total += e.amount;
      byCategory[key].count++;
    }

    return {
      period: { start: startDate, end: endDate },
      summary: { totalExpenses, totalItems: expenses.length },
      byCategory: Object.values(byCategory),
      expenses,
    };
  }

  async getDailyReport(date: string) {
    const reportDate = new Date(date);
    reportDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(reportDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: reportDate, lt: nextDay } },
      include: { waiter: { select: { id: true, name: true } } },
    });

    const expenses = await this.prisma.expense.findMany({
      where: { date: { gte: reportDate, lt: nextDay } },
      include: { category: true },
    });

    const cashOrders = orders.filter(o => o.paymentMethod === 'CASH' && o.status === 'DELIVERED');
    const transferOrders = orders.filter(o => o.paymentMethod === 'TRANSFER' && o.status === 'DELIVERED');
    const totalSales = orders.filter(o => o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
    const totalCash = cashOrders.reduce((s, o) => s + o.total, 0);
    const totalTransfers = transferOrders.reduce((s, o) => s + o.total, 0);
    const totalTips = orders.filter(o => o.status === 'DELIVERED').reduce((s, o) => s + (o.tip || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const paymentBreakdown: Record<string, number> = {};
    for (const o of delivered) {
      paymentBreakdown[o.paymentMethod] = (paymentBreakdown[o.paymentMethod] || 0) + o.total;
    }

    return {
      date,
      totalOrders: orders.length,
      ordersDelivered: delivered.length,
      ordersCancelled: orders.filter(o => o.status === 'CANCELLED').length,
      ordersPending: orders.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status)).length,
      totalSales,
      totalCash,
      totalTransfers,
      totalTips,
      totalExpenses,
      netIncome: totalSales - totalExpenses,
      paymentBreakdown: Object.entries(paymentBreakdown).map(([method, total]) => ({ method, total })),
    };
  }

  async getDashboardStats(startDate?: string, endDate?: string) {
    const key = `dashboard_stats_${startDate || 'today'}_${endDate || 'today'}`;
    return this.cache.getOrSet(key, async () => {
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const startDateStr = startDate || todayStr;
      const endDateStr = endDate || todayStr;

      let start = new Date(`${startDateStr}T05:00:00.000-05:00`);
      let end = new Date(`${endDateStr}T04:59:59.999-05:00`);
      end.setDate(end.getDate() + 1);

      const shiftForDate = await this.prisma.cashClosing.findFirst({
        where: {
          shiftStart: { gte: new Date(`${startDateStr}T00:00:00.000-05:00`), lte: new Date(`${endDateStr}T23:59:59.999-05:00`) },
        },
        orderBy: { shiftStart: 'desc' },
      });

      if (shiftForDate) {
        if (shiftForDate.shiftStart < start) {
          start = shiftForDate.shiftStart;
        }
        if (shiftForDate.isOpen) {
          end = new Date();
        } else if (shiftForDate.shiftEnd && shiftForDate.shiftEnd > end) {
          end = shiftForDate.shiftEnd;
        }
      }
      const [ordersInRange, activeOrdersCount, expensesInRange, totalOrders, allIngredients, allUsers] = await Promise.all([
        this.prisma.order.findMany({
          where: { createdAt: { gte: start, lte: end } },
          include: {
            items: { include: { menuItem: true } },
            waiter: { select: { id: true, name: true, photo: true, role: true } },
            assignee: { select: { id: true, name: true, photo: true } },
            payment: true,
            cashRegister: { select: { id: true, managerId: true } },
          },
        }),
        this.prisma.order.count({ where: { status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
        this.prisma.expense.findMany({
          where: { date: { gte: start, lte: end } },
        }),
        this.prisma.order.count(),
        this.prisma.ingredient.findMany({ where: { active: true } }),
        this.prisma.user.findMany({ select: { id: true, name: true, photo: true, role: true } }),
      ]);

      const rangeCustomersCount = new Set(ordersInRange.map(o => o.customerPhone).filter(Boolean)).size;
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const driversRanking = this.computeTopDrivers(ordersInRange);
      const sellersRanking = this.computeTopSellers(ordersInRange);
      const cashiersRanking = this.computeTopCashiers(ordersInRange, userMap);

      const salesInRange = ordersInRange.filter(o => o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
      const tipsInRange = ordersInRange.filter(o => o.status === 'DELIVERED').reduce((s, o) => s + (o.tip || 0), 0);
      const expensesInRangeTotal = expensesInRange.reduce((s, e) => s + e.amount, 0);
      const cashInRange = ordersInRange.filter(o => o.paymentMethod === 'CASH' && o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
      const transferInRange = ordersInRange.filter(o => o.paymentMethod === 'TRANSFER' && o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
      const creditInRange = ordersInRange.filter(o => o.paymentMethod === 'CREDIT' && o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);

      const topItemsMap = new Map<string, { name: string; quantity: number; price: number }>();
      for (const o of ordersInRange.filter(o => o.status === 'DELIVERED')) {
        for (const item of o.items) {
          if (!item.menuItem) continue;
          const key = item.menuItem.id;
          if (!topItemsMap.has(key)) {
            topItemsMap.set(key, { name: item.menuItem.name, quantity: 0, price: item.unitPrice });
          }
          const entry = topItemsMap.get(key)!;
          entry.quantity += item.quantity;
        }
      }
      const topItems = Array.from(topItemsMap.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);

      const lowStock = allIngredients.filter(i => i.stock <= i.minStock).slice(0, 10);

      let marginPercent = 0;
      let totalCogs = 0;
      if (salesInRange > 0) {
        try {
          const marginsReport = await this.getMarginsReport(
            start.toISOString().split('T')[0],
            end.toISOString().split('T')[0]
          );
          marginPercent = marginsReport.marginPercent;
          totalCogs = marginsReport.totalCogs;
        } catch (e) {
          console.error('Error fetching margins for dashboard:', e);
        }
      }

      const trend: { label: string; sales: number; expenses: number; net: number }[] = [];
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays > 1) {
        const tempDate = new Date(start);
        while (tempDate <= end) {
          const dayStart = new Date(tempDate);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(tempDate);
          dayEnd.setHours(23, 59, 59, 999);

          const dayOrders = ordersInRange.filter(o => o.createdAt >= dayStart && o.createdAt <= dayEnd && o.status === 'DELIVERED');
          const dayExpenses = expensesInRange.filter(e => e.date >= dayStart && e.date <= dayEnd);

          const daySales = dayOrders.reduce((sum, o) => sum + o.total, 0);
          const dayExpSum = dayExpenses.reduce((sum, e) => sum + e.amount, 0);

          const label = dayStart.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

          trend.push({
            label,
            sales: daySales,
            expenses: dayExpSum,
            net: daySales - dayExpSum,
          });

          tempDate.setDate(tempDate.getDate() + 1);
        }
      } else {
        for (let h = 0; h < 24; h += 2) {
          const slotStart = new Date(start);
          slotStart.setHours(h, 0, 0, 0);
          const slotEnd = new Date(start);
          slotEnd.setHours(h + 1, 59, 59, 999);

          const slotOrders = ordersInRange.filter(o => o.createdAt >= slotStart && o.createdAt <= slotEnd && o.status === 'DELIVERED');
          const slotExpenses = expensesInRange.filter(e => e.date >= slotStart && e.date <= slotEnd);

          const slotSales = slotOrders.reduce((sum, o) => sum + o.total, 0);
          const slotExpSum = slotExpenses.reduce((sum, e) => sum + e.amount, 0);

          trend.push({
            label: `${String(h).padStart(2, '0')}:00`,
            sales: slotSales,
            expenses: slotExpSum,
            net: slotSales - slotExpSum,
          });
        }
      }

      return {
        range: { start: start.toISOString(), end: end.toISOString() },
        today: {
          orders: ordersInRange.length,
          delivered: ordersInRange.filter(o => o.status === 'DELIVERED').length,
          pending: ordersInRange.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status)).length,
          cancelled: ordersInRange.filter(o => o.status === 'CANCELLED').length,
          sales: salesInRange,
          tips: tipsInRange,
          cash: cashInRange,
          transfer: transferInRange,
          creditSales: creditInRange,
          expenses: expensesInRangeTotal,
          cogs: totalCogs,
          marginPercent: marginPercent,
        },
        activeOrders: activeOrdersCount,
        totalOrders,
        totalCustomers: rangeCustomersCount,
        topWaiters: sellersRanking.slice(0, 5),
        topDrivers: driversRanking.slice(0, 5),
        topCashiers: cashiersRanking.slice(0, 5),
        topItems,
        lowStock,
        trend,
      };
    }, 10_000); // 10s micro-cache
  }

  private computeTopDrivers(orders: any[]) {
    const byDriver: Record<string, any> = {};
    for (const o of orders) {
      if (o.status !== 'DELIVERED' || !o.assignee || !o.assignedTo) continue;
      const key = o.assignedTo;
      if (!byDriver[key]) byDriver[key] = { waiterId: key, name: o.assignee.name, photo: o.assignee.photo, orders: 0, sales: 0 };
      byDriver[key].orders++;
      byDriver[key].sales += o.total;
    }
    return Object.values(byDriver).sort((a: any, b: any) => b.orders - a.orders);
  }

  private computeTopSellers(orders: any[]) {
    const bySeller: Record<string, any> = {};
    for (const o of orders) {
      if (o.status !== 'DELIVERED' || !o.waiter) continue;
      const key = o.waiterId;
      if (!bySeller[key]) bySeller[key] = { waiterId: key, name: o.waiter.name, photo: o.waiter.photo, orders: 0, sales: 0 };
      bySeller[key].orders++;
      bySeller[key].sales += o.total;
    }
    return Object.values(bySeller).sort((a: any, b: any) => b.sales - a.sales);
  }

  private computeTopCashiers(orders: any[], userMap: Map<string, any>) {
    const byCashier: Record<string, any> = {};
    for (const o of orders) {
      if (o.status !== 'DELIVERED') continue;
      const cashierId = o.payment?.confirmedBy || o.cashRegister?.managerId || (o.waiter?.role === 'CASHIER' ? o.waiterId : null);
      if (!cashierId) continue;
      const cashier = userMap.get(cashierId);
      if (!cashier) continue;
      if (!byCashier[cashierId]) byCashier[cashierId] = { waiterId: cashierId, name: cashier.name, photo: cashier.photo, orders: 0, sales: 0 };
      byCashier[cashierId].orders++;
      byCashier[cashierId].sales += o.total;
    }
    return Object.values(byCashier).sort((a: any, b: any) => b.sales - a.sales);
  }

  async getMarginsReport(startDate: string, endDate: string) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // 1. Obtener gastos de la categoría "Insumos"
    const expenses = await this.prisma.expense.findMany({
      where: {
        date: { gte: start, lte: end },
        category: { name: { equals: 'Insumos' } },
      },
    });
    const totalPurchased = expenses.reduce((sum, e) => sum + e.amount, 0);

    // 2. Obtener pedidos entregados y sus recetas
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: 'DELIVERED',
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                category: true,
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
            },
          },
        },
      },
    });

    const itemSales = new Map<string, {
      menuItemName: string;
      categoryName: string;
      quantitySold: number;
      unitPrice: number;
      totalRevenue: number;
      recipeCost: number;
      totalCogs: number;
    }>();

    let totalCogs = 0;
    let totalItemsQuantity = 0;

    for (const order of orders) {
      for (const item of order.items) {
        if (!item.menuItem) continue;
        const menuItem = item.menuItem;
        const key = menuItem.id;

        // Calcular costo de la receta actual
        let recipeCost = 0;
        if (menuItem.recipe && menuItem.recipe.items) {
          recipeCost = menuItem.recipe.items.reduce((sum, ri) => {
            return sum + (ri.quantity * (ri.ingredient.costPerUnit || 0));
          }, 0);
        }

        const itemCogsTotal = item.quantity * recipeCost;
        totalCogs += itemCogsTotal;
        totalItemsQuantity += item.quantity;

        if (!itemSales.has(key)) {
          itemSales.set(key, {
            menuItemName: menuItem.name,
            categoryName: menuItem.category.name,
            quantitySold: 0,
            unitPrice: item.unitPrice,
            totalRevenue: 0,
            recipeCost,
            totalCogs: 0,
          });
        }

        const entry = itemSales.get(key)!;
        entry.quantitySold += item.quantity;
        entry.totalRevenue += item.totalPrice;
        entry.totalCogs += itemCogsTotal;
        entry.unitPrice = item.unitPrice;
      }
    }

    const itemsReport = Array.from(itemSales.values()).map(entry => {
      const netProfit = entry.totalRevenue - entry.totalCogs;
      const margin = entry.totalRevenue > 0 ? (netProfit / entry.totalRevenue) : 0;
      let performance = 'Sin Receta';
      if (entry.recipeCost > 0) {
        performance = margin >= 0.40 ? 'Óptimo' : 'Bajo Margen';
      }
      return {
        ...entry,
        netProfit,
        margin: Math.round(margin * 100),
        performance,
      };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const foodSalesTotal = itemsReport.reduce((sum, i) => sum + i.totalRevenue, 0);
    const netProfit = foodSalesTotal - totalCogs;
    const marginPercent = foodSalesTotal > 0 ? Math.round((netProfit / foodSalesTotal) * 100) : 0;

    return {
      period: { start: startDate, end: endDate },
      totalPurchased,
      totalRevenue: foodSalesTotal,
      totalCogs,
      netProfit,
      marginPercent,
      totalItemsQuantity,
      items: itemsReport,
    };
  }

  async getAiInsights() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, status: 'DELIVERED' },
      include: { items: { include: { menuItem: true } }, zone: true }
    });

    const barrioMap = new Map<string, { name: string; count: number; total: number }>();
    orders.forEach(o => {
      const bName = o.zone?.name || o.addressReference || 'Sin especificar';
      if (!barrioMap.has(bName)) barrioMap.set(bName, { name: bName, count: 0, total: 0 });
      const b = barrioMap.get(bName)!;
      b.count++;
      b.total += o.total;
    });
    const topBarrios = Array.from(barrioMap.values()).sort((a, b) => b.count - a.count).slice(0, 5);

    const hourMap: Record<number, number> = {};
    orders.forEach(o => {
      const hourStr = new Date(o.createdAt).toLocaleString('en-US', { timeZone: 'America/Bogota', hour12: false, hour: 'numeric' });
      const h = parseInt(hourStr, 10);
      if (!isNaN(h)) {
        hourMap[h] = (hourMap[h] || 0) + 1;
      }
    });
    let peakHour = 19;
    let maxHourOrders = 0;
    Object.entries(hourMap).forEach(([hStr, count]) => {
      if (count > maxHourOrders) {
        maxHourOrders = count;
        peakHour = Number(hStr);
      }
    });

    const startHour12 = peakHour % 12 === 0 ? 12 : peakHour % 12;
    const endHourNum = (peakHour + 1) % 24;
    const endHour12 = endHourNum % 12 === 0 ? 12 : endHourNum % 12;
    const ampmStart = peakHour >= 12 ? 'PM' : 'AM';
    const ampmEnd = endHourNum >= 12 ? 'PM' : 'AM';
    const peakHourFormatted = `${startHour12}:00 ${ampmStart} - ${endHour12}:00 ${ampmEnd}`;

    const itemMap = new Map<string, { name: string; count: number; total: number }>();
    orders.forEach(o => {
      o.items.forEach(i => {
        if (!i.menuItem) return;
        const name = i.menuItem.name;
        if (!itemMap.has(name)) itemMap.set(name, { name, count: 0, total: 0 });
        const entry = itemMap.get(name)!;
        entry.count += i.quantity;
        entry.total += i.totalPrice;
      });
    });
    const topItems = Array.from(itemMap.values()).sort((a, b) => b.count - a.count).slice(0, 5);

    const summaryText = `
Resumen de datos reales de ventas del restaurante The Villa Dog (Últimos 30 días):
- Total Pedidos Entregados: ${orders.length}
- Venta Total: $${orders.reduce((sum, o) => sum + o.total, 0).toLocaleString('de-DE')} COP
- Barrios Top con más Domicilios: ${topBarrios.map(b => `${b.name} (${b.count} pedidos)`).join(', ')}
- Hora Pico con más Domicilios: ${peakHour}:00 - ${peakHour + 1}:00 hrs
- Platos más Vendidos: ${topItems.map(i => `${i.name} (${i.count} uds)`).join(', ')}
`;

    let aiPredictionText = "Se pronostica alta demanda durante las horas pico de la noche. Recomendamos verificar insumos de papas, queso y proteínas.";
    let aiAdviceText = "Aprovecha la concentración de pedidos en tu barrio top impulsando combos de bebidas o adicionales.";

    try {
      const apiKeySetting = await this.prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
      const apiKey = apiKeySetting?.value || process.env.GEMINI_API_KEY;

      if (apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const prompt = `
Eres la Inteligencia Artificial experta en analítica de ventas del restaurante "The Villa Dog" en Montería, Colombia.
Basado en los siguientes datos de ventas reales:
${summaryText}

Genera dos párrafos breves (SIN USAR EMOJIS):
1. PREDICCION DE DEMANDA: Pronóstico para mañana/hoy, horas pico esperadas e insumos que se deben preparar.
2. RECOMENDACION ESTRATEGICA: Sugerencia corta para vender más o hacer upsell.
`;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: AbortSignal.timeout(6000)
        });

        if (res.ok) {
          const data = await res.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const cleanText = rawText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
            const parts = cleanText.split('\n\n');
            if (parts[0]) aiPredictionText = parts[0];
            if (parts[1]) aiAdviceText = parts[1];
          }
        }
      }
    } catch (e) {
      // Fallback a contingencia local
    }

    return {
      prediction: aiPredictionText,
      recommendation: aiAdviceText,
      topBarrio: topBarrios[0] ? topBarrios[0].name : 'Montería Centro',
      topBarrioOrders: topBarrios[0] ? topBarrios[0].count : 0,
      peakHour: peakHourFormatted,
      topItem: topItems[0] ? topItems[0].name : 'Salchipapa The Villa Dog',
      topItemQuantity: topItems[0] ? topItems[0].count : 0,
      topBarrios,
      topItems
    };
  }

  async askAiQuestion(question: string) {
    if (!question || !question.trim()) {
      return { answer: 'Por favor escribe una pregunta para la Inteligencia Artificial.' };
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, status: 'DELIVERED' },
      include: { items: { include: { menuItem: true } }, zone: true }
    });

    const totalSales = orders.reduce((sum, o) => sum + o.total, 0);

    const barrioCounts: Record<string, number> = {};
    orders.forEach(o => {
      const b = o.zone?.name || o.addressReference || 'Sin especificar';
      barrioCounts[b] = (barrioCounts[b] || 0) + 1;
    });

    const itemCounts: Record<string, number> = {};
    orders.forEach(o => {
      o.items.forEach(i => {
        if (!i.menuItem) return;
        itemCounts[i.menuItem.name] = (itemCounts[i.menuItem.name] || 0) + i.quantity;
      });
    });

    const contextData = `
Datos reales del restaurante The Villa Dog (últimos 30 días):
- Total Ventas Entregadas: $${totalSales.toLocaleString('de-DE')} COP
- Total Pedidos: ${orders.length}
- Ventas por Barrio: ${JSON.stringify(barrioCounts)}
- Ventas por Plato: ${JSON.stringify(itemCounts)}
`;

    try {
      const apiKeySetting = await this.prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
      const rawKeys = apiKeySetting?.value || process.env.GEMINI_API_KEY || '';
      const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);

      if (apiKeys.length > 0) {
        const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-3.5-flash-lite'];
        const prompt = `
Eres la Inteligencia Artificial asesora de negocios de "The Villa Dog".
El dueño o cajero del restaurante pregunta: "${question}"

Utiliza la siguiente información real del restaurante:
${contextData}

Instrucciones:
1. Responde directamente a la pregunta con tono amable, claro y muy profesional.
2. Mantén la respuesta en máximo 2 párrafos breves.
3. ABSOLUTAMENTE PROHIBIDO USAR EMOJIS.
`;

        for (const key of apiKeys) {
          for (const model of modelsToTry) {
            try {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                signal: AbortSignal.timeout(10000)
              });

              if (res.ok) {
                const data = await res.json();
                let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (rawText) {
                  rawText = rawText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
                  return { answer: rawText };
                }
              }
            } catch (err) {
              // Probar siguiente modelo o clave
            }
          }
        }
      }
    } catch (e: any) {
      console.error('Error preguntando a la IA:', e);
    }

    // Respuesta inteligente basada en datos reales de la BD en caso de falla de red externa
    const sortedBarrios = Object.entries(barrioCounts).sort((a, b) => b[1] - a[1]);
    const sortedItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]);
    const topB = sortedBarrios[0] ? `${sortedBarrios[0][0]} (${sortedBarrios[0][1]} pedidos)` : 'Montería Centro';
    const topI = sortedItems[0] ? `${sortedItems[0][0]} (${sortedItems[0][1]} unidades)` : 'Salchipapa The Villa Dog';

    return { 
      answer: `Basado en los datos reales del restaurante The Villa Dog:\n• Barrio líder en domicilios: ${topB}.\n• Plato más vendido: ${topI}.\n• Total en los últimos 30 días: ${orders.length} pedidos entregados por $${totalSales.toLocaleString('de-DE')} COP.` 
    };
  }
}

