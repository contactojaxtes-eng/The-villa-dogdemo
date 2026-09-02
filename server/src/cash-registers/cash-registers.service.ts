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

    if (isNullReg) {
      // Ventas Fuera de Caja: solo pedidos huérfanos
      const activeClosing = await this.prisma.cashClosing.findFirst({
        where: { isOpen: true },
        orderBy: { shiftStart: 'desc' },
      });

      if (activeClosing && activeClosing.cashRegisterId) {
        await this.prisma.order.updateMany({
          where: {
            createdAt: { gte: activeClosing.shiftStart },
            cashRegisterId: null,
          },
          data: {
            cashRegisterId: activeClosing.cashRegisterId,
          },
        });
      }

      return {
        registerId: 'null',
        date: new Date().toISOString().split('T')[0],
        isOpen: false,
        orderCount: 0,
        totalSales: 0,
        totalCash: 0,
        totalTransfer: 0,
        totalNequi: 0,
        totalBancolombia: 0,
        totalDaviplata: 0,
        totalTips: 0,
        initialCash: 0,
        cashInDrawer: 0,
      };
    }

    // Para una caja registrada específica:
    const openClosing = await this.prisma.cashClosing.findFirst({
      where: { cashRegisterId: registerId, isOpen: true },
      include: { user: { select: { id: true, name: true } } },
    });

    // Si la caja está CERRADA (no tiene turno activo), se muestra en $0 para el turno actual
    if (!openClosing) {
      return {
        registerId,
        date: new Date().toISOString().split('T')[0],
        isOpen: false,
        orderCount: 0,
        totalSales: 0,
        totalCash: 0,
        totalTransfer: 0,
        totalNequi: 0,
        totalBancolombia: 0,
        totalDaviplata: 0,
        totalTips: 0,
        initialCash: 0,
        cashInDrawer: 0,
      };
    }

    // Si la caja está ABIERTA (turno activo en progreso):
    // Reasociar pedidos sin caja desde el inicio del turno
    await this.prisma.order.updateMany({
      where: {
        createdAt: { gte: openClosing.shiftStart },
        cashRegisterId: null,
      },
      data: {
        cashRegisterId: registerId,
      },
    });

    const orders = await this.prisma.order.findMany({
      where: {
        cashRegisterId: registerId,
        status: 'DELIVERED',
        createdAt: { gte: openClosing.shiftStart },
      },
    });

    const cashSales = orders.reduce((sum, o) => {
      if (o.paymentMethod === 'CASH') return sum + o.total;
      if (o.paymentMethod === 'MIXED') return sum + (o.cashAmount || 0);
      return sum;
    }, 0);

    const transferSales = orders.reduce((sum, o) => {
      if (o.paymentMethod === 'TRANSFER' || o.paymentMethod === 'NEQUI' || o.paymentMethod === 'BANCOLOMBIA' || o.paymentMethod === 'DAVIPLATA') return sum + o.total;
      if (o.paymentMethod === 'MIXED') return sum + (o.transferAmount || 0);
      return sum;
    }, 0);

    const initialCash = openClosing.initialCash || 0;

    return {
      registerId,
      date: openClosing.shiftStart.toISOString().split('T')[0],
      isOpen: true,
      shiftStart: openClosing.shiftStart,
      operatorName: openClosing.user?.name || 'Cajero',
      orderCount: orders.length,
      totalSales: orders.reduce((s, o) => s + o.total, 0),
      totalCash: cashSales,
      initialCash,
      cashInDrawer: initialCash + cashSales,
      totalTransfer: transferSales,
      totalNequi: orders.filter(o => o.paymentMethod === 'NEQUI').reduce((s, o) => s + o.total, 0),
      totalBancolombia: orders.filter(o => o.paymentMethod === 'BANCOLOMBIA').reduce((s, o) => s + o.total, 0),
      totalDaviplata: orders.filter(o => o.paymentMethod === 'DAVIPLATA').reduce((s, o) => s + o.total, 0),
      totalTips: orders.reduce((s, o) => s + (o.tip || 0), 0),
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
