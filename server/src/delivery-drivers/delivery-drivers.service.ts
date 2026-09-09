import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { CreateDriverDto, UpdateDriverDto } from './dto';

@Injectable()
export class DeliveryDriversService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway
  ) {}

  async create(data: CreateDriverDto) {
    const cleanPhone = data.phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10 || !cleanPhone.startsWith('3')) {
      throw new BadRequestException('El número de celular debe tener exactamente 10 dígitos y empezar con 3 (Ej: 3001234567)');
    }

    const payload = {
      name: data.name.trim(),
      phone: cleanPhone,
      active: data.active ?? true,
    };

    const created = await this.prisma.deliveryDriver.create({ data: payload });
    this.socketGateway.server.emit('driversChanged');
    return created;
  }

  private async buildOrderFilter(filterType = 'CURRENT', cashClosingId?: string, selectedDate?: string) {
    let orderDateFilter: any = {};

    const getBogotaStartOfDay = (dateObj: Date) => {
      const d = new Date(dateObj.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
      if (d.getHours() < 5) d.setDate(d.getDate() - 1);
      const dateStr = d.toLocaleDateString('en-CA');
      return new Date(`${dateStr}T05:00:00.000-05:00`);
    };

    const getBogotaEndOfDay = (dateStr: string) => {
      const d = new Date(`${dateStr}T05:00:00.000-05:00`);
      d.setDate(d.getDate() + 1);
      d.setMilliseconds(d.getMilliseconds() - 1);
      return d;
    };

    const now = new Date();

    if (filterType === 'ALL') {
      orderDateFilter = {};
    } else if (filterType === 'TODAY') {
      const todayStart = getBogotaStartOfDay(now);
      orderDateFilter = { createdAt: { gte: todayStart } };
    } else if (filterType === 'WEEK') {
      const todayBogota = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
      const dayOfWeek = todayBogota.getDay(); // 0 is Sunday, 1 is Monday
      const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(todayBogota);
      monday.setDate(todayBogota.getDate() - distanceToMonday);
      const weekStart = getBogotaStartOfDay(monday);
      orderDateFilter = { createdAt: { gte: weekStart } };
    } else if (filterType === 'MONTH') {
      const todayBogotaStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const monthStartStr = `${todayBogotaStr.substring(0, 7)}-01`;
      const monthStart = new Date(`${monthStartStr}T05:00:00.000-05:00`);
      orderDateFilter = { createdAt: { gte: monthStart } };
    } else if (filterType === 'DATE') {
      if (selectedDate) {
        const dateStart = new Date(`${selectedDate}T05:00:00.000-05:00`);
        const dateEnd = getBogotaEndOfDay(selectedDate);
        orderDateFilter = { createdAt: { gte: dateStart, lte: dateEnd } };
      } else {
        // A date report without a selected date must remain empty instead of
        // silently falling back to the current shift.
        orderDateFilter = { id: 'impossible_id_no_selected_date' };
      }
    } else if (filterType === 'CLOSING') {
      const closing = cashClosingId
        ? await this.prisma.cashClosing.findUnique({ where: { id: cashClosingId } })
        : null;
      if (closing) {
        orderDateFilter = {
          createdAt: {
            gte: closing.shiftStart,
            ...(closing.shiftEnd ? { lte: closing.shiftEnd } : {}),
          },
        };
      } else {
        // Do not show another shift while the user is choosing a closing.
        orderDateFilter = { id: 'impossible_id_no_selected_closing' };
      }
    } else {
      // Default: 'CURRENT' (Turno Actual)
      const activeClosing = await this.prisma.cashClosing.findFirst({
        where: {
          isOpen: true,
          cashRegister: { purpose: 'DELIVERY', active: true },
        },
        orderBy: { shiftStart: 'desc' },
      });
      if (activeClosing && activeClosing.shiftStart) {
        orderDateFilter = { createdAt: { gte: activeClosing.shiftStart } };
      } else {
        // If cash register is NOT open, "Turno Actual" means NOTHING. No orders.
        orderDateFilter = { id: 'impossible_id_no_active_shift' };
      }
    }
    return orderDateFilter;
  }

  async findAll(activeOnly = false, filterType = 'CURRENT', cashClosingId?: string, selectedDate?: string) {
    const driverWhere: any = activeOnly ? { active: true } : {};
    const orderDateFilter = await this.buildOrderFilter(filterType, cashClosingId, selectedDate);

    const drivers = await this.prisma.deliveryDriver.findMany({
      where: driverWhere,
      include: {
        orders: {
          where: orderDateFilter,
          select: {
            id: true,
            orderNumber: true,
            total: true,
            deliveryFee: true,
            status: true,
            createdAt: true,
            customerName: true,
            customerAddress: true,
            paymentMethod: true,
            paymentStatus: true,
            cashAmount: true,
            driverSettlementId: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Map each driver to include ranking and active workload stats
    return drivers.map(driver => {
      const completedOrdersList = driver.orders.filter(o => o.status === 'DELIVERED');
      const activeOrdersList = driver.orders.filter(o => o.status === 'IN_ROUTE');
      const completedOrders = completedOrdersList.length;
      const activeOrders = activeOrdersList.length;
      const totalEarnings = completedOrdersList.reduce((sum, order) => sum + order.deliveryFee, 0);
      const totalDeliveredSales = completedOrdersList.reduce((sum, order) => sum + order.total, 0);
      const pendingCashOrders = completedOrdersList.filter(order =>
        !order.driverSettlementId &&
        order.paymentStatus !== 'CONFIRMED' &&
        ['CASH', 'MIXED'].includes(order.paymentMethod)
      );
      const pendingCash = pendingCashOrders.reduce((sum, order) =>
        sum + (order.paymentMethod === 'MIXED' ? (order.cashAmount || 0) : order.total), 0
      );
      return {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        active: driver.active,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt,
        completedDeliveries: completedOrders,
        activeDeliveries: activeOrders,
        totalDeliveryEarnings: totalEarnings,
        totalDeliveredSales,
        pendingCash,
        pendingCashOrders: pendingCashOrders.map(order => ({
          id: order.id,
          orderNumber: order.orderNumber,
          amount: order.paymentMethod === 'MIXED' ? (order.cashAmount || 0) : order.total,
        })),
        orders: driver.orders,
      };
    });
  }

  async getPendingSettlements() {
    const openClosing = await this.prisma.cashClosing.findFirst({
      where: {
        isOpen: true,
        cashRegister: { purpose: 'DELIVERY', active: true },
      },
      select: { id: true, cashRegisterId: true, shiftStart: true },
      orderBy: { shiftStart: 'desc' },
    });
    if (!openClosing) return { cashClosingId: null, totalPendingCash: 0, drivers: [] };

    const orders = await this.prisma.order.findMany({
      where: {
        cashClosingId: openClosing.id,
        orderType: 'DELIVERY',
        status: 'DELIVERED',
        paymentMethod: { in: ['CASH', 'MIXED'] },
        paymentStatus: { not: 'CONFIRMED' },
        driverSettlementId: null,
        deliveryDriverId: { not: null },
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        cashAmount: true,
        paymentMethod: true,
        deliveryDriver: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const grouped = new Map<string, any>();
    for (const order of orders) {
      if (!order.deliveryDriver) continue;
      const amount = order.paymentMethod === 'MIXED' ? (order.cashAmount || 0) : order.total;
      const entry = grouped.get(order.deliveryDriver.id) || {
        driver: order.deliveryDriver,
        expectedCash: 0,
        orders: [],
      };
      entry.expectedCash += amount;
      entry.orders.push({ id: order.id, orderNumber: order.orderNumber, amount });
      grouped.set(order.deliveryDriver.id, entry);
    }

    const drivers = [...grouped.values()];
    return {
      cashClosingId: openClosing.id,
      totalPendingCash: drivers.reduce((sum, entry) => sum + entry.expectedCash, 0),
      drivers,
    };
  }

  async settleCash(
    driverId: string,
    data: { orderIds: string[]; receivedCash: number; notes?: string },
    receivedById: string,
  ) {
    const orderIds = [...new Set((data.orderIds || []).filter(Boolean))];
    if (!orderIds.length || orderIds.length > 100) {
      throw new BadRequestException('Selecciona al menos un pedido pendiente de liquidar.');
    }
    const receivedCash = Number(data.receivedCash);
    if (!Number.isFinite(receivedCash) || receivedCash < 0) {
      throw new BadRequestException('El efectivo recibido no es válido.');
    }

    const result = await this.prisma.$transaction(async tx => {
      const openClosing = await tx.cashClosing.findFirst({
        where: {
          isOpen: true,
          cashRegister: { purpose: 'DELIVERY', active: true },
        },
        select: { id: true },
        orderBy: { shiftStart: 'desc' },
      });
      if (!openClosing) throw new BadRequestException('La Caja Domicilios está cerrada.');

      const orders = await tx.order.findMany({
        where: {
          id: { in: orderIds },
          deliveryDriverId: driverId,
          cashClosingId: openClosing.id,
          orderType: 'DELIVERY',
          status: 'DELIVERED',
          paymentMethod: { in: ['CASH', 'MIXED'] },
          paymentStatus: { not: 'CONFIRMED' },
          driverSettlementId: null,
        },
        select: { id: true, total: true, cashAmount: true, paymentMethod: true },
      });
      if (orders.length !== orderIds.length) {
        throw new BadRequestException('Uno de los pedidos ya fue liquidado o no pertenece a este domiciliario y turno.');
      }

      const expectedCash = orders.reduce((sum, order) =>
        sum + (order.paymentMethod === 'MIXED' ? (order.cashAmount || 0) : order.total), 0
      );
      const settlement = await tx.driverSettlement.create({
        data: {
          driverId,
          cashClosingId: openClosing.id,
          receivedById,
          expectedCash,
          receivedCash,
          difference: receivedCash - expectedCash,
          notes: data.notes?.trim() || null,
        },
      });
      const linked = await tx.order.updateMany({
        where: { id: { in: orderIds }, driverSettlementId: null },
        data: { driverSettlementId: settlement.id, paymentStatus: 'CONFIRMED' },
      });
      if (linked.count !== orderIds.length) {
        throw new BadRequestException('La liquidación cambió mientras se procesaba. Intenta nuevamente.');
      }
      await tx.payment.updateMany({
        where: { orderId: { in: orderIds } },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: receivedById,
        },
      });
      return tx.driverSettlement.findUnique({
        where: { id: settlement.id },
        include: {
          driver: { select: { id: true, name: true, phone: true } },
          receivedBy: { select: { id: true, name: true } },
          orders: { select: { id: true, orderNumber: true, total: true, cashAmount: true, paymentMethod: true } },
        },
      });
    });

    this.socketGateway.server.emit('driverSettlementCreated', result);
    this.socketGateway.server.emit('driversChanged');
    this.socketGateway.server.emit('cashRegistersChanged');
    return result;
  }

  async getSettlements(driverId: string) {
    await this.findOne(driverId, 'ALL');
    return this.prisma.driverSettlement.findMany({
      where: { driverId },
      include: {
        receivedBy: { select: { id: true, name: true } },
        orders: { select: { id: true, orderNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string, filterType = 'CURRENT', cashClosingId?: string, selectedDate?: string) {
    const orderDateFilter = await this.buildOrderFilter(filterType, cashClosingId, selectedDate);

    const driver = await this.prisma.deliveryDriver.findUnique({
      where: { id },
      include: {
        orders: {
          where: orderDateFilter,
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!driver) throw new NotFoundException('Domiciliario no encontrado');
    return driver;
  }

  async update(id: string, data: UpdateDriverDto) {
    const driver = await this.prisma.deliveryDriver.findUnique({ where: { id } });
    if (!driver) throw new NotFoundException('Domiciliario no encontrado');

    const payload: any = { ...data };
    if (payload.name) payload.name = payload.name.trim();
    if (payload.phone) {
      const cleanPhone = payload.phone.replace(/\D/g, '');
      if (cleanPhone.length !== 10 || !cleanPhone.startsWith('3')) {
        throw new BadRequestException('El número de celular debe tener exactamente 10 dígitos y empezar con 3 (Ej: 3001234567)');
      }
      payload.phone = cleanPhone;
    }

    const updated = await this.prisma.deliveryDriver.update({
      where: { id },
      data: payload,
    });
    this.socketGateway.server.emit('driversChanged');
    return updated;
  }

  async remove(id: string) {
    const driver = await this.prisma.deliveryDriver.findUnique({ where: { id } });
    if (!driver) throw new NotFoundException('Domiciliario no encontrado');

    // Desvincular pedidos asignados a este domiciliario para evitar fallos de clave foránea
    await this.prisma.order.updateMany({
      where: { deliveryDriverId: id },
      data: { deliveryDriverId: null },
    });

    const deleted = await this.prisma.deliveryDriver.delete({
      where: { id },
    });
    this.socketGateway.server.emit('driversChanged');
    return deleted;
  }
}
