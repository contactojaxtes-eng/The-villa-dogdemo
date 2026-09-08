import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';

@Injectable()
export class CashRegistersService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
  ) {}

  async findAll() {
    const unassignedOpen = await this.prisma.cashClosing.findFirst({
      where: { isOpen: true, cashRegisterId: null },
      orderBy: { shiftStart: 'desc' },
    });
    if (unassignedOpen) {
      const defaultRegister = await this.prisma.cashRegister.findFirst({
        where: { active: true, purpose: { not: 'DELIVERY' } },
        orderBy: { name: 'asc' },
      });
      if (defaultRegister) {
        await this.prisma.cashClosing.update({
          where: { id: unassignedOpen.id },
          data: { cashRegisterId: defaultRegister.id },
        });
      }
    }

    return this.prisma.cashRegister.findMany({
      where: { active: true },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        closings: {
          where: { isOpen: true },
          include: { user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  private normalizePurpose(purpose?: string) {
    const value = String(purpose || 'GENERAL').trim().toUpperCase();
    if (!['GENERAL', 'DINING', 'DELIVERY'].includes(value)) {
      throw new BadRequestException('Tipo de caja inválido');
    }
    return value;
  }

  async create(data: { name: string; description?: string; managerId?: string; purpose?: string }) {
    const purpose = this.normalizePurpose(data.purpose);
    if (purpose === 'DELIVERY') {
      const existing = await this.prisma.cashRegister.findFirst({
        where: { purpose: 'DELIVERY', active: true },
        select: { id: true },
      });
      if (existing) throw new BadRequestException('Ya existe una Caja de Domicilios activa.');
    }
    const res = await this.prisma.cashRegister.create({
      data: { ...data, purpose },
      include: { manager: { select: { id: true, name: true } } },
    });
    this.socketGateway.server.emit('cashRegistersChanged');
    return res;
  }

  async update(id: string, data: Partial<{ name: string; description: string; managerId: string | null; active: boolean; purpose: string }>) {
    const current = await this.findOne(id);
    if (current.purpose === 'DELIVERY' && data.active === false) {
      throw new BadRequestException('La Caja Domicilios es necesaria para tomar pedidos y no se puede desactivar.');
    }
    if (data.purpose) {
      data.purpose = this.normalizePurpose(data.purpose);
      if (data.purpose !== current.purpose) {
        const [closingCount, orderCount] = await Promise.all([
          this.prisma.cashClosing.count({ where: { cashRegisterId: id } }),
          this.prisma.order.count({ where: { cashRegisterId: id } }),
        ]);
        if (closingCount > 0 || orderCount > 0) {
          throw new BadRequestException('No se puede cambiar el canal de una caja con movimientos. Crea una caja nueva para conservar el historial.');
        }
      }
      if (data.purpose === 'DELIVERY') {
        const existing = await this.prisma.cashRegister.findFirst({
          where: { purpose: 'DELIVERY', active: true, id: { not: id } },
          select: { id: true },
        });
        if (existing) throw new BadRequestException('Ya existe una Caja de Domicilios activa.');
      }
    }
    const res = await this.prisma.cashRegister.update({
      where: { id },
      data,
      include: { manager: { select: { id: true, name: true } } },
    });
    this.socketGateway.server.emit('cashRegistersChanged');
    return res;
  }

  async findOne(id: string) {
    const register = await this.prisma.cashRegister.findUnique({
      where: { id },
      include: { manager: { select: { id: true, name: true } } },
    });
    if (!register) throw new NotFoundException('Caja no encontrada');
    return register;
  }

  async getSummary(registerId: string, date?: string) {
    const isNullReg = registerId === 'null' || registerId === 'manual';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNullReg) {
      // Ventas Fuera de Caja: contabilizar pedidos que no tienen caja asignada
      const orphanOrders = await this.prisma.order.findMany({
        where: {
          cashRegisterId: null,
          status: { not: 'CANCELLED' },
          OR: [
            { status: 'DELIVERED' },
            { paymentStatus: 'CONFIRMED' },
            { payment: { status: 'CONFIRMED' } },
          ],
          createdAt: { gte: today },
        },
        include: { payment: true },
      });

      const totalSales = orphanOrders.reduce((s, o) => s + o.total, 0);
      const totalCash = orphanOrders.reduce((s, o) => {
        const m = o.payment?.method || o.paymentMethod;
        if (m === 'CASH') return s + o.total;
        if (m === 'MIXED') return s + (o.cashAmount || o.payment?.cashAmount || 0);
        return s;
      }, 0);
      const totalTransfer = orphanOrders.reduce((s, o) => {
        const m = o.payment?.method || o.paymentMethod;
        if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(m || '')) return s + o.total;
        if (m === 'MIXED') return s + (o.transferAmount || o.payment?.transferAmount || 0);
        return s;
      }, 0);

      return {
        registerId: 'null',
        date: today.toISOString().split('T')[0],
        isOpen: false,
        orderCount: orphanOrders.length,
        totalSales,
        totalCash,
        totalTransfer,
        totalNequi: orphanOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'NEQUI').reduce((s, o) => s + o.total, 0),
        totalBancolombia: orphanOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'BANCOLOMBIA').reduce((s, o) => s + o.total, 0),
        totalDaviplata: orphanOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'DAVIPLATA').reduce((s, o) => s + o.total, 0),
        totalTips: orphanOrders.reduce((s, o) => s + (o.tip || 0), 0),
        initialCash: 0,
        cashInDrawer: totalCash,
      };
    }

    const register = await this.prisma.cashRegister.findUnique({
      where: { id: registerId },
      select: { id: true, purpose: true },
    });
    if (!register) throw new NotFoundException('Caja no encontrada');
    const isDeliveryRegister = register.purpose === 'DELIVERY';

    // Para una caja registrada específica:
    let openClosing = await this.prisma.cashClosing.findFirst({
      where: { cashRegisterId: registerId, isOpen: true },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { shiftStart: 'desc' },
    });

    // Si la caja no tiene turno explícito pero hay un turno activo en el sistema, vincularlo
    if (!openClosing && !isDeliveryRegister) {
      const unassignedClosing = await this.prisma.cashClosing.findFirst({
        where: { isOpen: true, cashRegisterId: null },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { shiftStart: 'desc' },
      });
      if (unassignedClosing) {
        await this.prisma.cashClosing.update({
          where: { id: unassignedClosing.id },
          data: { cashRegisterId: registerId },
        });
        openClosing = { ...unassignedClosing, cashRegisterId: registerId };
      }
    }

    // Si no hay ningún turno activo abierto para esta caja:
    if (!openClosing) {
      return {
        registerId,
        date: today.toISOString().split('T')[0],
        isOpen: false,
        orderCount: 0,
        deliveryCount: 0,
        pickupCount: 0,
        paidOrderCount: 0,
        pendingPaymentCount: 0,
        pendingPaymentAmount: 0,
        totalSales: 0,
        totalCollected: 0,
        totalCash: 0,
        pendingDriverCash: 0,
        totalTransfer: 0,
        totalNequi: 0,
        totalBancolombia: 0,
        totalDaviplata: 0,
        totalTips: 0,
        totalExpenses: 0,
        initialCash: 0,
        cashInDrawer: 0,
      };
    }

    if (isDeliveryRegister) {
      // La caja de domicilios usa el turno enlazado al crear el pedido. El resumen
      // es deliberadamente de solo lectura para no absorber ventas de otro turno.
      const shiftOrders = await this.prisma.order.findMany({
        where: {
          cashClosingId: openClosing.id,
          cashRegisterId: registerId,
          orderType: { in: ['DELIVERY', 'PICKUP'] },
          status: { not: 'CANCELLED' },
        },
        include: { payment: true },
      });

      const totalExpenses = (await this.prisma.expense.findMany({
        where: { userId: openClosing.userId, createdAt: { gte: openClosing.shiftStart } },
      })).reduce((sum, expense) => sum + (expense.amount || 0), 0);
      const paymentMethod = (order: (typeof shiftOrders)[number]) => String(order.payment?.method || order.paymentMethod || '').toUpperCase().trim();
      const isCollected = (order: (typeof shiftOrders)[number]) => order.paymentStatus === 'CONFIRMED' || order.payment?.status === 'CONFIRMED';
      const isPendingPayment = (order: (typeof shiftOrders)[number]) => {
        const method = paymentMethod(order);
        return !['CREDIT', 'CORTESIA'].includes(method) && !isCollected(order);
      };
      const totalCash = shiftOrders.reduce((sum, order) => {
        const method = paymentMethod(order);
        if (!isCollected(order)) return sum;
        if (method === 'CASH') return sum + (order.total || 0);
        if (method === 'MIXED') return sum + (order.cashAmount || order.payment?.cashAmount || 0);
        return sum;
      }, 0);
      const pendingDriverCash = shiftOrders.reduce((sum, order) => {
        if (order.orderType !== 'DELIVERY' || order.status !== 'DELIVERED' || isCollected(order)) return sum;
        const method = paymentMethod(order);
        if (method === 'CASH') return sum + (order.total || 0);
        if (method === 'MIXED') return sum + (order.cashAmount || order.payment?.cashAmount || 0);
        return sum;
      }, 0);
      const totalTransfer = shiftOrders.reduce((sum, order) => {
        if (!isCollected(order)) return sum;
        const method = paymentMethod(order);
        if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)) return sum + (order.total || 0);
        if (method === 'MIXED') return sum + (order.transferAmount || order.payment?.transferAmount || 0);
        return sum;
      }, 0);
      const initialCash = openClosing.initialCash || 0;
      const deliveryCount = shiftOrders.filter(order => order.orderType === 'DELIVERY').length;
      const pickupCount = shiftOrders.filter(order => order.orderType === 'PICKUP').length;
      const paidOrderCount = shiftOrders.filter(isCollected).length;
      const pendingPaymentOrders = shiftOrders.filter(isPendingPayment);

      return {
        registerId,
        date: openClosing.shiftStart.toISOString().split('T')[0],
        isOpen: true,
        shiftStart: openClosing.shiftStart,
        operatorName: openClosing.user?.name || 'Gestor de domicilios',
        orderCount: shiftOrders.length,
        deliveryCount,
        pickupCount,
        paidOrderCount,
        pendingPaymentCount: pendingPaymentOrders.length,
        pendingPaymentAmount: pendingPaymentOrders.reduce((sum, order) => sum + (order.total || 0), 0),
        totalSales: shiftOrders.reduce((sum, order) => sum + (order.total || 0), 0),
        totalCollected: shiftOrders.filter(isCollected).reduce((sum, order) => sum + (order.total || 0), 0),
        totalCash,
        pendingDriverCash,
        initialCash,
        cashInDrawer: Math.max(0, initialCash + totalCash - totalExpenses),
        totalExpenses,
        totalTransfer,
        totalNequi: shiftOrders.filter(order => isCollected(order) && paymentMethod(order) === 'NEQUI').reduce((sum, order) => sum + order.total, 0),
        totalBancolombia: shiftOrders.filter(order => isCollected(order) && paymentMethod(order) === 'BANCOLOMBIA').reduce((sum, order) => sum + order.total, 0),
        totalDaviplata: shiftOrders.filter(order => isCollected(order) && paymentMethod(order) === 'DAVIPLATA').reduce((sum, order) => sum + order.total, 0),
        totalTips: shiftOrders.reduce((sum, order) => sum + (order.tip || 0), 0),
      };
    }

    // Si la caja está ABIERTA (turno activo en progreso):
    // Reasociar pedidos y mesas creados durante este turno activo que no tengan caja asignada
    await this.prisma.order.updateMany({
      where: {
        cashRegisterId: null,
        orderType: 'LOCAL',
        createdAt: { gte: openClosing.shiftStart },
      },
      data: {
        cashRegisterId: registerId,
      },
    }).catch(err => console.warn('Error reasociando pedidos a caja:', err));

    await this.prisma.diningTable.updateMany({
      where: {
        cashRegisterId: null,
        status: 'OPEN',
        openedAt: { gte: openClosing.shiftStart },
      },
      data: {
        cashRegisterId: registerId,
        cashClosingId: openClosing.id,
      },
    }).catch(err => console.warn('Error reasociando mesas a caja:', err));

    // Consultar pedidos que pertenecen estrictamente a este turno activo (a partir de shiftStart)
    const orders = await this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELLED' },
        orderType: 'LOCAL',
        OR: [
          // 1. Pedidos creados durante este turno
          {
            createdAt: { gte: openClosing.shiftStart },
            OR: [
              { cashRegisterId: registerId },
              { cashRegisterId: null },
              { diningTable: { cashRegisterId: registerId } },
              { diningTable: { cashClosingId: openClosing.id } },
            ],
          },
          // 2. Mesas de este turno activo
          {
            diningTable: { cashClosingId: openClosing.id },
          },
          // 3. Pagos confirmados durante este turno activo
          {
            payment: {
              confirmedAt: { gte: openClosing.shiftStart },
              status: 'CONFIRMED',
            },
            OR: [
              { cashRegisterId: registerId },
              { cashRegisterId: null },
            ],
          },
        ],
      },
      include: {
        payment: true,
        diningTable: true,
      },
    });

    // Si hay varias cajas, filtrar pedidos explícitamente asignados a otra caja
    const shiftOrders = orders.filter(
      o => !o.cashRegisterId || o.cashRegisterId === registerId || o.diningTable?.cashRegisterId === registerId || o.diningTable?.cashClosingId === openClosing.id
    );

    let totalExpenses = 0;
    try {
      const expenses = await this.prisma.expense.findMany({
        where: {
          createdAt: { gte: openClosing.shiftStart },
        },
      });
      totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    } catch (err) {
      console.warn('Error consultando gastos en getSummary:', err);
    }

    const cashSales = shiftOrders.reduce((sum, o) => {
      const method = String(o.payment?.method || o.paymentMethod || '').toUpperCase().trim();
      if (method === 'CASH') return sum + (o.total || 0);
      if (method === 'MIXED') return sum + (o.cashAmount || o.payment?.cashAmount || 0);
      return sum;
    }, 0);

    const transferSales = shiftOrders.reduce((sum, o) => {
      const method = String(o.payment?.method || o.paymentMethod || '').toUpperCase().trim();
      if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(method)) return sum + (o.total || 0);
      if (method === 'MIXED') return sum + (o.transferAmount || o.payment?.transferAmount || 0);
      return sum;
    }, 0);

    const initialCash = openClosing.initialCash || 0;
    const totalSales = shiftOrders.reduce((s, o) => s + (o.total || 0), 0);
    const cashInDrawer = Math.max(0, initialCash + cashSales - totalExpenses);

    return {
      registerId,
      date: openClosing.shiftStart.toISOString().split('T')[0],
      isOpen: true,
      shiftStart: openClosing.shiftStart,
      operatorName: openClosing.user?.name || 'Cajero',
      orderCount: shiftOrders.length,
      totalSales,
      totalCash: cashSales,
      initialCash,
      cashInDrawer,
      totalExpenses,
      totalTransfer: transferSales,
      totalNequi: shiftOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'NEQUI').reduce((s, o) => s + (o.total || 0), 0),
      totalBancolombia: shiftOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'BANCOLOMBIA').reduce((s, o) => s + (o.total || 0), 0),
      totalDaviplata: shiftOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'DAVIPLATA').reduce((s, o) => s + (o.total || 0), 0),
      totalTips: shiftOrders.reduce((s, o) => s + (o.tip || 0), 0),
    };
  }

  async remove(id: string) {
    const register = await this.findOne(id);
    if (register.purpose === 'DELIVERY') {
      throw new BadRequestException('La Caja Domicilios es necesaria para tomar pedidos y no se puede desactivar.');
    }
    const openClosing = await this.prisma.cashClosing.findFirst({
      where: { cashRegisterId: id, isOpen: true },
      select: { id: true },
    });
    if (openClosing) {
      throw new BadRequestException('Cierra el turno antes de desactivar esta caja.');
    }

    // Se conserva la caja y todas sus relaciones para que los cierres históricos
    // sigan siendo auditables. findAll ya oculta las cajas inactivas.
    const res = await this.prisma.cashRegister.update({
      where: { id },
      data: { active: false },
    });
    this.socketGateway.server.emit('cashRegistersChanged');
    return res;
  }
}
