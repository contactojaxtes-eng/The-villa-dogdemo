import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@Injectable()
export class CashRegistersService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
  ) {}

  async findAll(siteId = DEFAULT_SITE_ID) {
    return this.prisma.cashRegister.findMany({
      where: { siteId, active: true },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        closings: {
          where: { siteId, isOpen: true },
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

  private async assertManagerBelongsToSite(managerId: string | undefined | null, siteId: string) {
    if (!managerId) return;
    const membership = await this.prisma.userSiteMembership.findFirst({
      where: { userId: managerId, siteId, active: true },
      select: { userId: true },
    });
    if (!membership) throw new BadRequestException('El responsable no pertenece a esta sede.');
  }

  async create(data: { name: string; description?: string; managerId?: string; purpose?: string }, siteId = DEFAULT_SITE_ID) {
    const purpose = this.normalizePurpose(data.purpose);
    await this.assertManagerBelongsToSite(data.managerId, siteId);
    if (purpose === 'DELIVERY') {
      const existing = await this.prisma.cashRegister.findFirst({
        where: { siteId, purpose: 'DELIVERY', active: true },
        select: { id: true },
      });
      if (existing) throw new BadRequestException('Ya existe una Caja de Domicilios activa.');
    }
    const res = await this.prisma.cashRegister.create({
      data: { ...data, purpose, siteId },
      include: { manager: { select: { id: true, name: true } } },
    });
    this.socketGateway.emitToSite(siteId, 'cashRegistersChanged');
    return res;
  }

  async update(id: string, data: Partial<{ name: string; description: string; managerId: string | null; active: boolean; purpose: string }>, siteId = DEFAULT_SITE_ID) {
    const current = await this.findOne(id, siteId);
    if (Object.prototype.hasOwnProperty.call(data, 'managerId')) {
      await this.assertManagerBelongsToSite(data.managerId, siteId);
    }
    if (current.purpose === 'DELIVERY' && data.active === false) {
      throw new BadRequestException('La Caja Domicilios es necesaria para tomar pedidos y no se puede desactivar.');
    }
    if (data.purpose) {
      data.purpose = this.normalizePurpose(data.purpose);
      if (current.purpose === 'DELIVERY' && data.purpose !== 'DELIVERY') {
        throw new BadRequestException('La Caja Domicilios es necesaria para tomar pedidos y no se puede cambiar de canal.');
      }
      if (data.purpose !== current.purpose) {
        const [closingCount, orderCount] = await Promise.all([
          this.prisma.cashClosing.count({ where: { siteId, cashRegisterId: id } }),
          this.prisma.order.count({ where: { siteId, cashRegisterId: id } }),
        ]);
        if (closingCount > 0 || orderCount > 0) {
          throw new BadRequestException('No se puede cambiar el canal de una caja con movimientos. Crea una caja nueva para conservar el historial.');
        }
      }
      if (data.purpose === 'DELIVERY') {
        const existing = await this.prisma.cashRegister.findFirst({
          where: { siteId, purpose: 'DELIVERY', active: true, id: { not: id } },
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
    this.socketGateway.emitToSite(siteId, 'cashRegistersChanged');
    return res;
  }

  async findOne(id: string, siteId = DEFAULT_SITE_ID) {
    const register = await this.prisma.cashRegister.findFirst({
      where: { id, siteId },
      include: { manager: { select: { id: true, name: true } } },
    });
    if (!register) throw new NotFoundException('Caja no encontrada');
    return register;
  }

  async getSummary(registerId: string, date?: string, siteId = DEFAULT_SITE_ID) {
    const isNullReg = registerId === 'null' || registerId === 'manual';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNullReg) {
      // Ventas Fuera de Caja: contabilizar pedidos que no tienen caja asignada
      const orphanOrders = await this.prisma.order.findMany({
        where: {
          siteId,
          cashRegisterId: null,
          orderType: 'LOCAL',
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
        // totalTransfer representa únicamente transferencias bancarias; las
        // billeteras se exponen por separado para poder sumarlas sin duplicar.
        if (m === 'TRANSFER') return s + o.total;
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

    const register = await this.prisma.cashRegister.findFirst({
      where: { id: registerId, siteId },
      select: { id: true, purpose: true },
    });
    if (!register) throw new NotFoundException('Caja no encontrada');
    const isDeliveryRegister = register.purpose === 'DELIVERY';

    // Para una caja registrada específica:
    let openClosing = await this.prisma.cashClosing.findFirst({
      where: { siteId, cashRegisterId: registerId, isOpen: true },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { shiftStart: 'desc' },
    });

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
          siteId,
          cashClosingId: openClosing.id,
          cashRegisterId: registerId,
          orderType: { in: ['DELIVERY', 'PICKUP'] },
          status: { not: 'CANCELLED' },
        },
        include: { payment: true },
      });

      const totalExpenses = (await this.prisma.expense.findMany({
        where: { siteId, userId: openClosing.userId, createdAt: { gte: openClosing.shiftStart } },
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
        if (method === 'TRANSFER') return sum + (order.total || 0);
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

    // El resumen no modifica pedidos ni mesas. Así una consulta nunca puede
    // apropiarse de movimientos de otra caja abierta.
    const otherDiningRegisters = await this.prisma.cashRegister.findMany({
      where: { siteId, id: { not: registerId }, purpose: { not: 'DELIVERY' }, active: true },
      select: { id: true },
    });
    const otherDiningIds = otherDiningRegisters.map(r => r.id);

    const orders = await this.prisma.order.findMany({
      where: {
        siteId,
        status: { not: 'CANCELLED' },
        orderType: 'LOCAL',
        OR: [
          // 1. Pedidos creados durante este turno
          {
            createdAt: { gte: openClosing.shiftStart },
            OR: [
              { cashRegisterId: registerId },
              { diningTable: { cashRegisterId: registerId } },
              { diningTable: { cashClosingId: openClosing.id } },
              { cashRegisterId: null },
              { cashRegister: { purpose: 'DELIVERY' } },
              { diningTable: { cashRegister: { purpose: 'DELIVERY' } } },
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
              { diningTable: { cashRegisterId: registerId } },
              { diningTable: { cashClosingId: openClosing.id } },
              { cashRegisterId: null },
              { cashRegister: { purpose: 'DELIVERY' } },
              { diningTable: { cashRegister: { purpose: 'DELIVERY' } } },
            ],
          },
        ],
      },
      include: {
        payment: true,
        diningTable: true,
      },
    });

    // Atribuir a esta caja de salón todos los pedidos locales excepto los asignados explícitamente a otra caja de salón
    const shiftOrders = orders.filter(
      o => !otherDiningIds.includes(o.cashRegisterId || '') && !otherDiningIds.includes(o.diningTable?.cashRegisterId || ''),
    );

    let totalExpenses = 0;
    try {
      const expenses = await this.prisma.expense.findMany({
        where: {
          siteId,
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
      if (method === 'TRANSFER') return sum + (o.total || 0);
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

  async remove(id: string, siteId = DEFAULT_SITE_ID) {
    const register = await this.findOne(id, siteId);
    if (register.purpose === 'DELIVERY') {
      throw new BadRequestException('La Caja Domicilios es necesaria para tomar pedidos y no se puede desactivar.');
    }
    const openClosing = await this.prisma.cashClosing.findFirst({
      where: { siteId, cashRegisterId: id, isOpen: true },
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
    this.socketGateway.emitToSite(siteId, 'cashRegistersChanged');
    return res;
  }
}
