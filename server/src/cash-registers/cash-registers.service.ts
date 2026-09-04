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
        where: { active: true },
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

  async create(data: { name: string; description?: string; managerId?: string }) {
    const res = await this.prisma.cashRegister.create({
      data,
      include: { manager: { select: { id: true, name: true } } },
    });
    this.socketGateway.server.emit('cashRegistersChanged');
    return res;
  }

  async update(id: string, data: Partial<{ name: string; description: string; managerId: string | null; active: boolean }>) {
    await this.findOne(id);
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

    // Para una caja registrada específica:
    let openClosing = await this.prisma.cashClosing.findFirst({
      where: { cashRegisterId: registerId, isOpen: true },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { shiftStart: 'desc' },
    });

    // Si la caja no tiene turno explícito pero hay un turno activo en el sistema, vincularlo
    if (!openClosing) {
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

    if (!openClosing) {
      const anyOpen = await this.prisma.cashClosing.findFirst({
        where: { isOpen: true },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { shiftStart: 'desc' },
      });
      if (anyOpen) {
        openClosing = anyOpen;
      }
    }

    // Si no hay ningún turno activo abierto:
    if (!openClosing) {
      const dayOrders = await this.prisma.order.findMany({
        where: {
          status: { not: 'CANCELLED' },
          createdAt: { gte: today },
          OR: [
            { cashRegisterId: registerId },
            { diningTable: { cashRegisterId: registerId } },
          ],
        },
        include: { payment: true },
      });

      const totalSales = dayOrders.reduce((s, o) => s + o.total, 0);
      const totalCash = dayOrders.reduce((s, o) => {
        const m = o.payment?.method || o.paymentMethod;
        if (m === 'CASH') return s + o.total;
        if (m === 'MIXED') return s + (o.cashAmount || o.payment?.cashAmount || 0);
        return s;
      }, 0);
      const totalTransfer = dayOrders.reduce((s, o) => {
        const m = o.payment?.method || o.paymentMethod;
        if (['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(m || '')) return s + o.total;
        if (m === 'MIXED') return s + (o.transferAmount || o.payment?.transferAmount || 0);
        return s;
      }, 0);

      return {
        registerId,
        date: today.toISOString().split('T')[0],
        isOpen: false,
        orderCount: dayOrders.length,
        totalSales,
        totalCash,
        totalTransfer,
        totalNequi: dayOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'NEQUI').reduce((s, o) => s + o.total, 0),
        totalBancolombia: dayOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'BANCOLOMBIA').reduce((s, o) => s + o.total, 0),
        totalDaviplata: dayOrders.filter(o => (o.payment?.method || o.paymentMethod) === 'DAVIPLATA').reduce((s, o) => s + o.total, 0),
        totalTips: dayOrders.reduce((s, o) => s + (o.tip || 0), 0),
        initialCash: 0,
        cashInDrawer: totalCash,
      };
    }

    // Si la caja está ABIERTA (turno activo en progreso):
    // Reasociar pedidos y mesas sin caja desde el inicio del turno o de hoy
    await this.prisma.order.updateMany({
      where: {
        cashRegisterId: null,
        OR: [
          { createdAt: { gte: openClosing.shiftStart } },
          { updatedAt: { gte: openClosing.shiftStart } },
          { createdAt: { gte: today } },
        ],
      },
      data: {
        cashRegisterId: registerId,
      },
    }).catch(err => console.warn('Error reasociando pedidos a caja:', err));

    await this.prisma.diningTable.updateMany({
      where: {
        cashRegisterId: null,
        status: 'OPEN',
      },
      data: {
        cashRegisterId: registerId,
        cashClosingId: openClosing.id,
      },
    }).catch(err => console.warn('Error reasociando mesas a caja:', err));

    // Consultar todos los pedidos del turno activo no cancelados
    const orders = await this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELLED' },
        OR: [
          { createdAt: { gte: openClosing.shiftStart } },
          { updatedAt: { gte: openClosing.shiftStart } },
          { payment: { confirmedAt: { gte: openClosing.shiftStart } } },
          { diningTable: { cashClosingId: openClosing.id } },
          { cashRegisterId: registerId, createdAt: { gte: today } },
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
    await this.findOne(id);
    await this.prisma.order.updateMany({
      where: { cashRegisterId: id },
      data: { cashRegisterId: null },
    });
    await this.prisma.cashClosing.updateMany({
      where: { cashRegisterId: id },
      data: { cashRegisterId: null },
    });
    const res = await this.prisma.cashRegister.delete({
      where: { id },
    });
    this.socketGateway.server.emit('cashRegistersChanged');
    return res;
  }
}
