import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { DeliveryDriverGateway } from '../socket/delivery-driver.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { TablesService } from '../tables/tables.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
    @Inject(forwardRef(() => WhatsappService)) private whatsappService: WhatsappService,
    @Optional() @Inject(forwardRef(() => TablesService)) private tablesService?: TablesService,
    @Optional() private deliveryDriverGateway?: DeliveryDriverGateway,
  ) {}

  async findAll(params: { status?: string; method?: string; date?: string }, cashierId?: string) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.method) where.method = params.method;
    if (params.date) {
      const start = new Date(params.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(params.date);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }
    if (cashierId) {
      where.OR = [
        { status: 'PENDING' },
        { confirmedBy: cashierId }
      ];
    }
    return this.prisma.payment.findMany({
      where,
      include: { order: { select: { id: true, orderNumber: true, customerName: true, customerPhone: true, total: true, cashRegisterId: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async confirmPayment(id: string, confirmedBy: string) {
    const user = await this.prisma.user.findUnique({ where: { id: confirmedBy } });
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      // Conserva la protección de caja para cajeros incluso ante un enlace de
      // pago vencido o inválido; un domicilio válido se resuelve más abajo por
      // su propio turno compartido.
      if (user?.role === 'CASHIER') {
        const activeClosing = await this.prisma.cashClosing.findFirst({
          where: { userId: confirmedBy, isOpen: true },
        });
        if (!activeClosing) {
          throw new BadRequestException('Debes tener una caja abierta para registrar o confirmar cobros.');
        }
      }
      throw new NotFoundException('Pago no encontrado');
    }

    const currentOrder = await this.prisma.order.findUnique({
      where: { id: payment.orderId },
      select: { cashClosingId: true, cashRegisterId: true, orderType: true },
    });
    if (!currentOrder) throw new NotFoundException('Pedido no encontrado');

    const isDeliveryOrder = ['DELIVERY', 'PICKUP'].includes(currentOrder.orderType);
    let activeClosing: any = null;
    if (isDeliveryOrder) {
      // Los pagos de domicilio siempre quedan en el turno compartido de domicilios.
      // Nunca deben absorberse por la caja personal de quien confirma el pago.
      activeClosing = await this.prisma.cashClosing.findFirst({
        where: {
          isOpen: true,
          cashRegister: { purpose: 'DELIVERY', active: true },
        },
        orderBy: { shiftStart: 'desc' },
      });
      if (!activeClosing) {
        throw new BadRequestException('La Caja Domicilios está cerrada. Ábrela antes de confirmar el cobro.');
      }
    } else if (user?.role === 'CASHIER') {
      activeClosing = await this.prisma.cashClosing.findFirst({
        where: { userId: confirmedBy, isOpen: true },
      });
      if (!activeClosing) {
        throw new BadRequestException('Debes tener una caja abierta para registrar o confirmar cobros.');
      }
    } else {
      activeClosing = await this.prisma.cashClosing.findFirst({
        where: { userId: confirmedBy, isOpen: true },
      });
    }

    const updated = await this.prisma.payment.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy },
    });
    const updatedOrder = await this.prisma.order.update({
      where: { id: payment.orderId },
      data: { 
        paymentStatus: 'CONFIRMED',
        ...(!currentOrder.cashClosingId && activeClosing?.cashRegisterId
          ? { cashRegisterId: activeClosing.cashRegisterId, cashClosingId: activeClosing.id }
          : {})
      },
    });
    this.socketGateway.server.emit('paymentUpdated', updated);
    this.socketGateway.server.emit('orderUpdated', updatedOrder);
    this.socketGateway.server.emit('cashRegistersChanged');
    await this.deliveryDriverGateway?.emitForOrder(updatedOrder, {
      reason: 'payment_validated',
      orderId: updatedOrder.id,
    });
    if (updatedOrder.customerPhone) {
      await this.whatsappService.unassignSessionByPhone(updatedOrder.customerPhone).catch(() => {});
    }
    return updated;
  }

  async rejectPayment(id: string, confirmedBy: string) {
    const user = await this.prisma.user.findUnique({ where: { id: confirmedBy } });
    if (user?.role === 'CASHIER') {
      const activeClosing = await this.prisma.cashClosing.findFirst({
        where: { userId: confirmedBy, isOpen: true },
      });
      if (!activeClosing) {
        throw new BadRequestException('Debes tener una caja abierta para rechazar cobros.');
      }
    }

    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { status: 'REJECTED', confirmedBy },
    });
    const updatedOrder = await this.prisma.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: 'REJECTED' },
    });
    this.socketGateway.server.emit('paymentUpdated', updated);
    this.socketGateway.server.emit('orderUpdated', updatedOrder);
    this.socketGateway.server.emit('cashRegistersChanged');
    await this.deliveryDriverGateway?.emitForOrder(updatedOrder, {
      reason: 'payment_rejected',
      orderId: updatedOrder.id,
    });
    return updated;
  }

  async getCashClosingToday(userId: string, cashRegisterId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    let openCash = await this.prisma.cashClosing.findFirst({
      where: cashRegisterId
        ? { cashRegisterId, isOpen: true }
        : { userId, isOpen: true },
    });

    if (!openCash && !cashRegisterId && (user?.role === 'ADMIN' || user?.role === 'SUPERADMIN')) {
      openCash = await this.prisma.cashClosing.findFirst({
        where: { isOpen: true },
        orderBy: { shiftStart: 'desc' },
      });
    }

    if (!openCash) {
      return {
        totalCash: 0,
        pendingDriverCash: 0,
        totalTransfers: 0,
        totalNequi: 0,
        totalBancolombia: 0,
        totalDaviplata: 0,
        totalSales: 0,
        totalTips: 0,
        totalExpenses: 0,
        orderCount: 0,
        deliveryCount: 0,
        pickupCount: 0,
        paidOrderCount: 0,
        pendingPaymentCount: 0,
        pendingPaymentAmount: 0,
        totalCollected: 0,
        isOpen: false,
        initialCash: 0,
        creditSales: 0,
        totalCreditPayments: 0,
      };
    }

    const start = openCash.shiftStart;
    const end = new Date();
    const targetUserId = openCash.userId;
    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    const targetIsCashier = targetUser?.role === 'CASHIER';
    const register = openCash.cashRegisterId
      ? await this.prisma.cashRegister.findUnique({
          where: { id: openCash.cashRegisterId },
          select: { purpose: true },
        })
      : null;
    const isDeliveryRegister = register?.purpose === 'DELIVERY';

    let orders: any[] = [];
    try {
      orders = await this.prisma.order.findMany({
        where: isDeliveryRegister
          ? {
              cashClosingId: openCash.id,
              cashRegisterId: openCash.cashRegisterId!,
              orderType: { in: ['DELIVERY', 'PICKUP'] },
              status: { not: 'CANCELLED' },
            }
          : {
              createdAt: { gte: start, lte: end },
              status: { not: 'CANCELLED' },
              orderType: 'LOCAL',
              ...(openCash.cashRegisterId
                ? { cashRegisterId: openCash.cashRegisterId }
                : (targetIsCashier ? {
                    OR: [
                      { waiterId: targetUserId },
                      { payment: { confirmedBy: targetUserId } },
                    ],
                  } : {})),
            },
      });
    } catch (err) {
      console.warn('Error en consulta principal de órdenes en getCashClosingToday, reintentando con filtro básico:', err);
      orders = await this.prisma.order.findMany({
        where: {
          createdAt: { gte: start, lte: end },
          status: { not: 'CANCELLED' },
          ...(isDeliveryRegister ? {} : { orderType: 'LOCAL' }),
          ...(isDeliveryRegister
            ? { cashClosingId: openCash.id, orderType: { in: ['DELIVERY', 'PICKUP'] } }
            : (openCash.cashRegisterId ? { cashRegisterId: openCash.cashRegisterId } : {}))
        },
      }).catch(() => []);
    }

    const paymentIsSettled = (order: any) =>
      order.paymentStatus === 'CONFIRMED' ||
      order.payment?.status === 'CONFIRMED' ||
      ['CREDIT', 'CORTESIA'].includes(order.paymentMethod);
    const cashWasCollected = (order: any) => !isDeliveryRegister || paymentIsSettled(order);
    const byMethod = (method: string) => orders
      .filter(order => order.paymentMethod === method && cashWasCollected(order))
      .reduce((sum, order) => sum + order.total, 0);

    // Ventas a crédito creadas durante este turno
    const creditSales = byMethod('CREDIT');

    // Pagos de créditos confirmados durante este turno (pueden ser de pedidos creados hoy o antes)
    let creditPayments: any[] = [];
    try {
      creditPayments = await this.prisma.payment.findMany({
        where: {
          confirmedAt: { gte: start, lte: end },
          status: 'CONFIRMED',
          order: {
            paymentMethod: 'CREDIT',
            ...(isDeliveryRegister
              ? { cashClosingId: openCash.id, orderType: { in: ['DELIVERY', 'PICKUP'] } }
              : { orderType: 'LOCAL', ...(openCash.cashRegisterId ? { cashRegisterId: openCash.cashRegisterId } : {}) })
          },
          ...(!openCash.cashRegisterId && targetIsCashier ? { confirmedBy: targetUserId } : {})
        }
      });
    } catch (err) {
      console.warn('Error consultando creditPayments en getCashClosingToday:', err);
    }

    const creditByMethod = (method: string) => creditPayments.filter(p => p.method === method).reduce((sum, p) => sum + p.amount, 0);

    // Abonos generales de clientes (cuentas por cobrar) realizados durante este turno
    let customerPayments: any[] = [];
    try {
      customerPayments = await this.prisma.customerPayment.findMany({
        where: {
          createdAt: { gte: start, lte: end },
          ...(openCash.cashRegisterId ? { cashRegisterId: openCash.cashRegisterId } : {}),
          ...(!openCash.cashRegisterId && targetIsCashier ? { confirmedById: targetUserId } : {})
        }
      });
    } catch (err) {
      console.warn('Error consultando customerPayments en getCashClosingToday:', err);
    }

    const customerPaymentsCash = customerPayments.filter(p => p.method === 'CASH').reduce((sum, p) => sum + p.amount, 0);
    const customerPaymentsTransfer = customerPayments.filter(p => p.method === 'TRANSFER').reduce((sum, p) => sum + p.amount, 0);
    const mixedCash = orders.filter(o => o.paymentMethod === 'MIXED' && cashWasCollected(o)).reduce((sum, o) => sum + (o.cashAmount || 0), 0);
    const mixedTransfer = orders.filter(o => o.paymentMethod === 'MIXED' && cashWasCollected(o)).reduce((sum, o) => sum + (o.transferAmount || 0), 0);

    const totalCash = byMethod('CASH') + mixedCash + creditByMethod('CASH') + customerPaymentsCash;
    const totalTransfers = byMethod('TRANSFER') + mixedTransfer + creditByMethod('TRANSFER') + customerPaymentsTransfer;
    const totalNequi = byMethod('NEQUI') + creditByMethod('NEQUI');
    const totalBancolombia = byMethod('BANCOLOMBIA') + creditByMethod('BANCOLOMBIA');
    const totalDaviplata = byMethod('DAVIPLATA') + creditByMethod('DAVIPLATA');

    const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
    const totalTips = orders.reduce((sum, o) => sum + (o.tip || 0), 0);
    const pendingDriverCash = isDeliveryRegister
      ? orders.reduce((sum, order) => {
          if (order.status !== 'DELIVERED' || cashWasCollected(order)) return sum;
          if (order.paymentMethod === 'CASH') return sum + order.total;
          if (order.paymentMethod === 'MIXED') return sum + (order.cashAmount || 0);
          return sum;
        }, 0)
      : 0;
    const pendingPaymentOrders = isDeliveryRegister
      ? orders.filter(order =>
          !['CREDIT', 'CORTESIA'].includes(order.paymentMethod) && !paymentIsSettled(order),
        )
      : [];
    const deliveryCount = isDeliveryRegister
      ? orders.filter(order => order.orderType === 'DELIVERY').length
      : 0;
    const pickupCount = isDeliveryRegister
      ? orders.filter(order => order.orderType === 'PICKUP').length
      : 0;

    let totalExpenses = 0;
    try {
      const expenses = await this.prisma.expense.findMany({
        where: { 
          createdAt: { gte: start, lte: end },
          ...((targetIsCashier || isDeliveryRegister) ? { userId: targetUserId } : {})
        },
      });
      totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    } catch (err) {
      console.warn('Error consultando expenses en getCashClosingToday:', err);
    }

    return {
      totalCash,
      pendingDriverCash,
      totalTransfers,
      totalNequi,
      totalBancolombia,
      totalDaviplata,
      totalSales,
      totalTips,
      totalExpenses,
      orderCount: orders.length,
      deliveryCount,
      pickupCount,
      paidOrderCount: isDeliveryRegister ? orders.filter(paymentIsSettled).length : orders.length,
      pendingPaymentCount: pendingPaymentOrders.length,
      pendingPaymentAmount: pendingPaymentOrders.reduce((sum, order) => sum + order.total, 0),
      totalCollected: totalCash + totalTransfers + totalNequi + totalBancolombia + totalDaviplata,
      isOpen: true,
      initialCash: openCash.initialCash || 0,
      creditSales,
      totalCreditPayments: creditPayments.reduce((sum, p) => sum + p.amount, 0) + customerPayments.reduce((sum, p) => sum + p.amount, 0),
    };
  }

  async getAllCashClosingsToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const openCashes = await this.prisma.cashClosing.findMany({
      where: { isOpen: true },
      include: { user: { select: { id: true, name: true } } },
    });

    return openCashes;
  }

  async createCashClosing(userId: string, data: { shiftStart: string; notes?: string; cashRegisterId?: string }) {
    const openClosing = await this.prisma.cashClosing.findFirst({
      where: data.cashRegisterId
        ? { cashRegisterId: data.cashRegisterId, isOpen: true }
        : { userId, isOpen: true },
      orderBy: { createdAt: 'desc' },
    });

    const targetRegisterId = data.cashRegisterId || openClosing?.cashRegisterId;
    const targetRegister = targetRegisterId
      ? await this.prisma.cashRegister.findUnique({
          where: { id: targetRegisterId },
          select: { purpose: true },
        })
      : null;
    const isDeliveryRegister = targetRegister?.purpose === 'DELIVERY';
    const pendingCount = await this.prisma.order.count({
      where: {
        status: { in: ['PENDING', 'IN_ROUTE', 'READY'] },
        ...(isDeliveryRegister && openClosing
          ? {
              cashClosingId: openClosing.id,
              orderType: { in: ['DELIVERY', 'PICKUP'] },
            }
          : (targetRegisterId ? { cashRegisterId: targetRegisterId } : {}))
      }
    });

    if (pendingCount > 0) {
      throw new BadRequestException(`No se puede cerrar la caja. Hay ${pendingCount} pedido(s) activo(s) pendiente(s) de entrega o cobro. Por favor finalízalos o cancélalos antes de cerrar el turno.`);
    }

    if (isDeliveryRegister && openClosing) {
      const pendingDriverCash = await this.prisma.order.count({
        where: {
          cashClosingId: openClosing.id,
          orderType: 'DELIVERY',
          status: 'DELIVERED',
          paymentMethod: { in: ['CASH', 'MIXED'] },
          paymentStatus: { not: 'CONFIRMED' },
          driverSettlementId: null,
        },
      });
      if (pendingDriverCash > 0) {
        throw new BadRequestException(`No se puede cerrar la Caja Domicilios. Hay ${pendingDriverCash} pedido(s) con efectivo pendiente por entregar del domiciliario.`);
      }

      const pendingPayments = await this.prisma.order.count({
        where: {
          cashClosingId: openClosing.id,
          orderType: { in: ['DELIVERY', 'PICKUP'] },
          status: { not: 'CANCELLED' },
          paymentMethod: { notIn: ['CREDIT', 'CORTESIA'] },
          paymentStatus: { not: 'CONFIRMED' },
        },
      });
      if (pendingPayments > 0) {
        throw new BadRequestException(`No se puede cerrar la Caja Domicilios. Hay ${pendingPayments} pedido(s) con pago pendiente de confirmar.`);
      }
    }

    if (this.tablesService) {
      await this.tablesService.assertNoOpenTableWork(targetRegisterId);
    }

    const targetUserIdForStats = openClosing ? openClosing.userId : userId;
    const stats = await this.getCashClosingToday(targetUserIdForStats, data.cashRegisterId);

    const shiftStartDate = openClosing?.shiftStart || new Date(data.shiftStart);

    // Ajuste matemático de la discrepancia para ventas a crédito y cobros realizados
    const receipts = stats.totalCash + stats.totalTransfers + stats.totalNequi + stats.totalBancolombia + stats.totalDaviplata;
    const salesPaidToday = (stats.totalSales - (stats.creditSales || 0)) + (stats.totalCreditPayments || 0);
    const discrepancy = receipts - salesPaidToday;

    let closing;
    if (openClosing) {
      closing = await this.prisma.cashClosing.update({
        where: { id: openClosing.id },
        data: {
          shiftEnd: new Date(),
          totalCash: stats.totalCash,
          totalTransfers: stats.totalTransfers,
          totalNequi: stats.totalNequi,
          totalBancolombia: stats.totalBancolombia,
          totalDaviplata: stats.totalDaviplata,
          totalSales: stats.totalSales,
          totalTips: stats.totalTips,
          totalExpenses: stats.totalExpenses,
          discrepancy,
          notes: data.notes,
          isOpen: false,
        },
      });
    } else {
      closing = await this.prisma.cashClosing.create({
        data: {
          userId,
          shiftStart: shiftStartDate,
          shiftEnd: new Date(),
          createdAt: shiftStartDate,
          initialCash: 0,
          totalCash: stats.totalCash,
          totalTransfers: stats.totalTransfers,
          totalNequi: stats.totalNequi,
          totalBancolombia: stats.totalBancolombia,
          totalDaviplata: stats.totalDaviplata,
          totalSales: stats.totalSales,
          totalTips: stats.totalTips,
          totalExpenses: stats.totalExpenses,
          discrepancy,
          notes: data.notes,
          isOpen: false,
          cashRegisterId: data.cashRegisterId,
        },
      });
    }

    const anyOpen = await this.prisma.cashClosing.findFirst({
      where: { isOpen: true },
    });
    this.socketGateway.server.emit('cashStatusChanged', { isOpen: !!anyOpen });
    this.socketGateway.server.emit('cashRegistersChanged');
    if (isDeliveryRegister) {
      await this.deliveryDriverGateway?.emitForAllDrivers({ reason: 'delivery_shift_closed' });
    }
    if (this.tablesService) {
      await this.tablesService.purgeProofsForClosing(closing.id);
    }
    return closing;
  }

  async getCashClosings(params: { date?: string; userId?: string; cashRegisterId?: string }) {
    const where: any = {
      isOpen: false,
    };
    if (params.userId) where.userId = params.userId;
    if (params.cashRegisterId) where.cashRegisterId = params.cashRegisterId;
    if (params.date) {
      const start = new Date(params.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(params.date);
      end.setHours(23, 59, 59, 999);
      // Permite encontrar el cierre tanto si se busca el día que inició el turno como si se busca el día que cerró (después de medianoche)
      where.OR = [
        { createdAt: { gte: start, lte: end } },
        { shiftStart: { gte: start, lte: end } },
        { shiftEnd: { gte: start, lte: end } },
      ];
    }
    return this.prisma.cashClosing.findMany({
      where,
      include: { 
        user: { select: { id: true, name: true } },
        cashRegister: { select: { id: true, name: true, purpose: true } }
      },
      orderBy: { shiftEnd: 'desc' },
    });
  }

  async openCash(userId: string, data: { initialCash: number; cashRegisterId?: string }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const whereClause: any = data.cashRegisterId
      ? { cashRegisterId: data.cashRegisterId, isOpen: true }
      : { userId, isOpen: true };

    const existingOpen = await this.prisma.cashClosing.findFirst({
      where: whereClause,
    });
    if (existingOpen) {
      return existingOpen;
    }

    const open = await this.prisma.cashClosing.create({
      data: {
        userId,
        shiftStart: new Date(),
        initialCash: data.initialCash || 0,
        isOpen: true,
        cashRegisterId: data.cashRegisterId,
      },
    });

    this.socketGateway.server.emit('cashStatusChanged', { isOpen: true });
    this.socketGateway.server.emit('cashRegistersChanged');

    if (data.cashRegisterId) {
      const register = await this.prisma.cashRegister.findUnique({
        where: { id: data.cashRegisterId },
        select: { purpose: true },
      });
      if (register?.purpose === 'DELIVERY') {
        await this.deliveryDriverGateway?.emitForAllDrivers({ reason: 'delivery_shift_opened' });
      }
    }

    return open;
  }

  async getOpenCash(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'DELIVERY_MANAGER') {
      return this.prisma.cashClosing.findFirst({
        where: {
          isOpen: true,
          cashRegister: { purpose: 'DELIVERY', active: true },
        },
        orderBy: { shiftStart: 'desc' },
      });
    }

    if (user?.role === 'ADMIN' || user?.role === 'SUPERADMIN') {
      return this.prisma.cashClosing.findFirst({
        where: { isOpen: true },
      });
    }

    return this.prisma.cashClosing.findFirst({
      where: { userId, isOpen: true },
    });
  }

  // --- Liquidar Crédito (Cartera) ---
  async payCreditOrder(orderId: string, data: { method: string; reference?: string }, cashierId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.paymentMethod !== 'CREDIT') throw new BadRequestException('El pedido no fue registrado a crédito');

    const isDeliveryOrder = ['DELIVERY', 'PICKUP'].includes(order.orderType);
    // Un abono de domicilio siempre se registra en Caja Domicilios. Un pago
    // hecho por un cajero no puede mover ese pedido a su caja personal.
    const activeClosing = await this.prisma.cashClosing.findFirst({
      where: isDeliveryOrder
        ? { isOpen: true, cashRegister: { purpose: 'DELIVERY', active: true } }
        : { userId: cashierId, isOpen: true },
      orderBy: isDeliveryOrder ? { shiftStart: 'desc' } : undefined,
    });

    const user = await this.prisma.user.findUnique({ where: { id: cashierId } });
    if (isDeliveryOrder && !activeClosing) {
      throw new BadRequestException('La Caja Domicilios está cerrada. Ábrela antes de registrar el pago.');
    }
    if (!isDeliveryOrder && user?.role === 'CASHIER' && !activeClosing) {
      throw new BadRequestException('Debes tener una caja abierta para registrar pagos de crédito.');
    }

    // Actualizar el pedido. Mantenemos order.paymentMethod = 'CREDIT' para auditoría,
    // pero confirmamos el estado de pago.
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'CONFIRMED',
        ...(!order.cashClosingId && activeClosing?.cashRegisterId
          ? { cashRegisterId: activeClosing.cashRegisterId, cashClosingId: activeClosing.id }
          : {}),
      },
    });

    let payment = order.payment;
    if (!payment) {
      payment = await this.prisma.payment.create({
        data: {
          orderId,
          amount: order.total,
          method: data.method,
          reference: data.reference,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: cashierId,
        },
      });
    } else {
      payment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          method: data.method,
          reference: data.reference,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedBy: cashierId,
        },
      });
    }

    if (order.customerId) {
      await this.prisma.customerPayment.create({
        data: {
          customerId: order.customerId,
          amount: order.total,
          method: data.method,
          reference: data.reference || null,
          notes: `Liquidación de Pedido #${order.orderNumber}`,
          cashRegisterId: activeClosing?.cashRegisterId || null,
          confirmedById: cashierId,
        }
      });
    }

    this.socketGateway.server.emit('paymentUpdated', payment);
    this.socketGateway.server.emit('orderUpdated', orderId);
    this.socketGateway.server.emit('cashRegistersChanged');
    await this.deliveryDriverGateway?.emitForOrder(orderId, {
      reason: 'payment_changed',
      orderId,
    });

    if (order.customerPhone) {
      await this.whatsappService.unassignSessionByPhone(order.customerPhone).catch(() => {});
    }

    return payment;
  }

  // ── Detalle expandido de un cierre para Reporte Z profesional ──
  async getClosingDetail(closingId: string) {
    const closing = await this.prisma.cashClosing.findUnique({
      where: { id: closingId },
      include: {
        user: { select: { id: true, name: true } },
        cashRegister: { select: { id: true, name: true, purpose: true } },
      },
    });
    if (!closing) throw new NotFoundException('Cierre de caja no encontrado');
    const effectiveEnd = closing.isOpen ? new Date() : (closing.shiftEnd || new Date());
    const isDeliveryRegister = closing.cashRegister?.purpose === 'DELIVERY';

    // El detalle es estrictamente de lectura: los pedidos se vinculan al turno
    // cuando se crean, así un reporte histórico no altera ni absorbe movimientos.
    const whereOrders: any = isDeliveryRegister
      ? {
          cashClosingId: closing.id,
          cashRegisterId: closing.cashRegisterId,
          orderType: { in: ['DELIVERY', 'PICKUP'] },
          status: { not: 'CANCELLED' },
        }
      : {
          createdAt: { gte: closing.shiftStart, lte: effectiveEnd },
          status: { not: 'CANCELLED' },
          orderType: 'LOCAL',
          ...(closing.cashRegisterId ? { cashRegisterId: closing.cashRegisterId } : {}),
        };

    const orders = await this.prisma.order.findMany({ 
      where: whereOrders,
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        deliveryDriver: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Pagos de crédito confirmados durante el turno
    const creditPayments = await this.prisma.payment.findMany({
      where: {
        confirmedAt: { gte: closing.shiftStart, lte: effectiveEnd },
        status: 'CONFIRMED',
        order: {
          paymentMethod: 'CREDIT',
          ...(isDeliveryRegister
            ? { cashClosingId: closing.id, orderType: { in: ['DELIVERY', 'PICKUP'] } }
            : { orderType: 'LOCAL', ...(closing.cashRegisterId ? { cashRegisterId: closing.cashRegisterId } : {}) }),
        },
      },
    });

    // Gastos del turno con categoría
    const expenses = await this.prisma.expense.findMany({
      where: {
        createdAt: { gte: closing.shiftStart, lte: effectiveEnd },
        ...(isDeliveryRegister ? { userId: closing.userId } : {}),
      },
      include: { category: { select: { name: true } } },
    });

    // ── Cálculos por método de pago ──
    const METHODS = ['CASH', 'TRANSFER', 'CREDIT', 'CORTESIA'] as const;
    const METHOD_LABELS: Record<string, string> = {
      CASH: 'Efectivo',
      TRANSFER: 'Transferencia',
      CREDIT: 'Crédito',
      CORTESIA: 'Cortesía',
    };

    const salesByMethod: Record<string, { count: number; sales: number; tips: number; deliveryFees: number; subtotal: number; tax: number }> = {};
    for (const m of METHODS) {
      salesByMethod[m] = { count: 0, sales: 0, tips: 0, deliveryFees: 0, subtotal: 0, tax: 0 };
    }

    for (const o of orders) {
      const m = o.paymentMethod || 'CASH';
      if (m === 'MIXED') {
        const cashPart = o.cashAmount || 0;
        const transferPart = o.transferAmount || 0;
        salesByMethod['CASH'].count += 1;
        salesByMethod['CASH'].sales += cashPart;
        salesByMethod['TRANSFER'].count += 1;
        salesByMethod['TRANSFER'].sales += transferPart;
        salesByMethod['CASH'].tips += o.tip || 0;
        salesByMethod['CASH'].deliveryFees += o.deliveryFee || 0;
        salesByMethod['CASH'].subtotal += o.subtotal || 0;
        salesByMethod['CASH'].tax += o.tax || 0;
      } else {
        if (!salesByMethod[m]) {
          salesByMethod[m] = { count: 0, sales: 0, tips: 0, deliveryFees: 0, subtotal: 0, tax: 0 };
        }
        salesByMethod[m].count += 1;
        salesByMethod[m].sales += o.total;
        salesByMethod[m].tips += o.tip || 0;
        salesByMethod[m].deliveryFees += o.deliveryFee || 0;
        salesByMethod[m].subtotal += o.subtotal || 0;
        salesByMethod[m].tax += o.tax || 0;
      }
    }

    // Totales generales
    const totalTransactions = orders.length;
    const totalSalesValue = orders.reduce((s, o) => s + o.total, 0);
    const totalTips = orders.reduce((s, o) => s + (o.tip || 0), 0);
    const totalDeliveryFees = orders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const totalSubtotal = orders.reduce((s, o) => s + (o.subtotal || 0), 0);
    let totalTax = orders.reduce((s, o) => s + (o.tax || 0), 0);
    if (totalTax === 0 && totalSubtotal > 0) {
      totalTax = Math.round(totalSubtotal * 0.08);
    }
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    // Gastos agrupados por categoría
    const expensesByCategory: Record<string, number> = {};
    for (const e of expenses) {
      const catName = e.category?.name || 'Otros';
      expensesByCategory[catName] = (expensesByCategory[catName] || 0) + e.amount;
    }

    // Resumen financiero preciso
    const cashSales = salesByMethod['CASH']?.sales || 0;
    const initialPlusRevenue = closing.initialCash + totalSalesValue + totalTips;
    const totalCashMustHave = closing.initialCash + cashSales - totalExpenses;

    // Construir respuesta por método
    const ventasPorMetodo = METHODS.map(m => ({
      method: m,
      label: METHOD_LABELS[m] || m,
      count: salesByMethod[m]?.count || 0,
      sales: salesByMethod[m]?.sales || 0,
      tips: salesByMethod[m]?.tips || 0,
      deliveryFees: salesByMethod[m]?.deliveryFees || 0,
      subtotal: salesByMethod[m]?.subtotal || 0,
      tax: salesByMethod[m]?.tax || 0,
    }));

    // Inicial por método de pago (solo lo que teníamos al abrir)
    const inicialPorMetodo = [
      { label: 'Efectivo', value: closing.initialCash },
      { label: 'Transferencia', value: 0 },
      { label: 'Crédito', value: 0 },
      { label: 'Cortesía', value: 0 },
    ];

    const customerPayments = await this.prisma.customerPayment.findMany({
      where: {
        createdAt: { gte: closing.shiftStart, lte: effectiveEnd },
        ...(closing.cashRegisterId ? { cashRegisterId: closing.cashRegisterId } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      closing: {
        id: closing.id,
        shiftStart: closing.shiftStart,
        shiftEnd: closing.shiftEnd,
        initialCash: closing.initialCash,
        totalCash: closing.totalCash,
        totalTransfers: closing.totalTransfers,
        totalNequi: closing.totalNequi,
        totalBancolombia: closing.totalBancolombia,
        totalDaviplata: closing.totalDaviplata,
        totalSales: closing.totalSales,
        totalTips: closing.totalTips,
        totalExpenses: closing.totalExpenses,
        discrepancy: closing.discrepancy,
        notes: closing.notes,
        user: closing.user,
        cashRegister: closing.cashRegister,
      },
      transacciones: totalTransactions,
      valorTransacciones: totalSalesValue,
      propinas: totalTips,
      domicilios: totalDeliveryFees,
      inicialPorMetodo,
      ventasPorMetodo,
      orders: orders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        total: o.total,
        paymentMethod: o.paymentMethod,
        createdAt: o.createdAt,
        driverName: o.deliveryDriver?.name || null,
        itemsSummary: o.items.map(i => `${i.quantity}x ${i.menuItem?.name || 'Producto'}${i.unitPrice === 0 ? ' (Cortesía)' : ''}`).join(', ')
      })),
      abonosCartera: {
        total: customerPayments.reduce((s, p) => s + p.amount, 0),
        totalCash: customerPayments.filter(p => p.method === 'CASH').reduce((s, p) => s + p.amount, 0),
        totalTransfer: customerPayments.filter(p => p.method === 'TRANSFER').reduce((s, p) => s + p.amount, 0),
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
          confirmedBy: closing.user?.name || 'Cajero',
        })),
      },
      impuestos: {
        nombre: 'INC (8%)',
        base: totalSubtotal,
        impuesto: totalTax,
      },
      gastos: {
        items: Object.entries(expensesByCategory).map(([tipo, total]) => ({ tipo, total })),
        total: totalExpenses,
      },
      resumen: {
        inicialMasVentasMasPropinas: initialPlusRevenue,
        pagosFacturas: 0,
        gastos: totalExpenses,
        totalEfectivo: totalCashMustHave,
        debeTener: totalCashMustHave,
        domicilios: totalDeliveryFees,
      },
    };
  }

  async getConsolidatedClosing(dateStr?: string) {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const isToday = !dateStr || dateStr === todayStr;

    let start: Date;
    let end: Date;
    let initialCashTotal = 0;

    if (isToday) {
      const activeClosing = await this.prisma.cashClosing.findFirst({
        where: { isOpen: true },
        orderBy: { shiftStart: 'desc' },
      });

      if (activeClosing && activeClosing.shiftStart) {
        start = activeClosing.shiftStart;
        end = new Date();
        const openClosings = await this.prisma.cashClosing.findMany({
          where: { isOpen: true },
        });
        initialCashTotal = openClosings.reduce((s, c) => s + (c.initialCash || 0), 0);
      } else {
        const lastClosing = await this.prisma.cashClosing.findFirst({
          orderBy: { shiftEnd: 'desc' },
        });
        if (lastClosing && lastClosing.shiftEnd) {
          start = lastClosing.shiftEnd;
        } else {
          start = new Date(`${todayStr}T00:00:00.000-05:00`);
        }
        end = new Date();
        initialCashTotal = 0;
      }
    } else {
      start = new Date(`${dateStr}T00:00:00.000-05:00`);
      end = new Date(`${dateStr}T23:59:59.999-05:00`);

      const shiftForDate = await this.prisma.cashClosing.findFirst({
        where: {
          shiftStart: { gte: start, lte: end },
        },
        orderBy: { shiftStart: 'desc' },
      });

      if (shiftForDate) {
        if (shiftForDate.isOpen) {
          end = new Date();
        } else if (shiftForDate.shiftEnd && shiftForDate.shiftEnd > end) {
          end = shiftForDate.shiftEnd;
        }
        initialCashTotal = shiftForDate.initialCash || 0;
      }
    }

    // Get all orders delivered or paid on this day for all registers
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { not: 'CANCELLED' },
        OR: [
          { status: 'DELIVERED' },
          { paymentStatus: 'CONFIRMED' },
          { paymentMethod: { not: '' } },
        ],
      },
    });

    const expenses = await this.prisma.expense.findMany({
      where: {
        createdAt: { gte: start, lte: end },
      },
      include: { category: { select: { name: true } } },
    });

    // ── Cálculos por método de pago ──
    const METHODS = ['CASH', 'TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA', 'CREDIT'] as const;
    const METHOD_LABELS: Record<string, string> = {
      CASH: 'Efectivo',
      TRANSFER: 'Transferencia',
      NEQUI: 'Nequi',
      BANCOLOMBIA: 'Bancolombia',
      DAVIPLATA: 'Daviplata',
      CREDIT: 'Crédito',
    };

    const salesByMethod: Record<string, { count: number; sales: number; tips: number; deliveryFees: number; subtotal: number; tax: number }> = {};
    for (const m of METHODS) {
      salesByMethod[m] = { count: 0, sales: 0, tips: 0, deliveryFees: 0, subtotal: 0, tax: 0 };
    }

    for (const o of orders) {
      const m = o.paymentMethod || 'CASH';
      if (!salesByMethod[m]) {
        salesByMethod[m] = { count: 0, sales: 0, tips: 0, deliveryFees: 0, subtotal: 0, tax: 0 };
      }
      salesByMethod[m].count += 1;
      salesByMethod[m].sales += o.total;
      salesByMethod[m].tips += o.tip || 0;
      salesByMethod[m].deliveryFees += o.deliveryFee || 0;
      salesByMethod[m].subtotal += o.subtotal || 0;
      salesByMethod[m].tax += o.tax || 0;
    }

    // Totales generales
    const totalTransactions = orders.length;
    const totalSalesValue = orders.reduce((s, o) => s + o.total, 0);
    const totalTips = orders.reduce((s, o) => s + (o.tip || 0), 0);
    const totalDeliveryFees = orders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const totalSubtotal = orders.reduce((s, o) => s + (o.subtotal || 0), 0);
    const totalTax = orders.reduce((s, o) => s + (o.tax || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    // Gastos agrupados por categoría
    const expensesByCategory: Record<string, number> = {};
    for (const e of expenses) {
      const catName = e.category?.name || 'Otros';
      expensesByCategory[catName] = (expensesByCategory[catName] || 0) + e.amount;
    }

    // Find all cash closings belonging to this date range
    const closings = await this.prisma.cashClosing.findMany({
      where: {
        isOpen: false,
        OR: [
          { shiftEnd: { gte: start, lte: end } },
          { createdAt: { gte: start, lte: end } },
          { shiftStart: { gte: start, lte: end } },
        ],
      },
    });

    const sumInitialCash = closings.reduce((s, c) => s + c.initialCash, 0);
    const sumTotalCash = closings.reduce((s, c) => s + c.totalCash, 0);
    const sumTotalTransfers = closings.reduce((s, c) => s + c.totalTransfers, 0);
    const sumTotalNequi = closings.reduce((s, c) => s + c.totalNequi, 0);
    const sumTotalBancolombia = closings.reduce((s, c) => s + c.totalBancolombia, 0);
    const sumTotalDaviplata = closings.reduce((s, c) => s + c.totalDaviplata, 0);
    const sumTotalSales = closings.reduce((s, c) => s + c.totalSales, 0);
    const sumTotalTips = closings.reduce((s, c) => s + c.totalTips, 0);
    const sumTotalExpenses = closings.reduce((s, c) => s + c.totalExpenses, 0);
    const sumDiscrepancy = closings.reduce((s, c) => s + c.discrepancy, 0);

    const finalInitial = initialCashTotal > 0 ? initialCashTotal : sumInitialCash;
    const cashSales = salesByMethod['CASH']?.sales || 0;
    const finalCash = sumTotalCash > 0 ? sumTotalCash : cashSales;
    const finalTransfers = sumTotalTransfers > 0 ? sumTotalTransfers : salesByMethod['TRANSFER']?.sales || 0;
    const finalNequi = sumTotalNequi > 0 ? sumTotalNequi : salesByMethod['NEQUI']?.sales || 0;
    const finalBancolombia = sumTotalBancolombia > 0 ? sumTotalBancolombia : salesByMethod['BANCOLOMBIA']?.sales || 0;
    const finalDaviplata = sumTotalDaviplata > 0 ? sumTotalDaviplata : salesByMethod['DAVIPLATA']?.sales || 0;

    let totalTaxCalc = totalTax;
    if (totalTaxCalc === 0 && totalSubtotal > 0) {
      totalTaxCalc = Math.round(totalSubtotal * 0.08);
    }

    // Resumen final
    const initialPlusRevenue = finalInitial + totalSalesValue + totalTips;
    const totalCashMustHave = finalInitial + cashSales - totalExpenses;

    // Construir respuesta por método
    const ventasPorMetodo = METHODS.map(m => ({
      method: m,
      label: METHOD_LABELS[m] || m,
      count: salesByMethod[m]?.count || 0,
      sales: salesByMethod[m]?.sales || 0,
      tips: salesByMethod[m]?.tips || 0,
      deliveryFees: salesByMethod[m]?.deliveryFees || 0,
      subtotal: salesByMethod[m]?.subtotal || 0,
      tax: salesByMethod[m]?.tax || 0,
    }));

    // Inicial por método de pago (solo lo que teníamos al abrir)
    const inicialPorMetodo = [
      { label: 'Efectivo', value: finalInitial },
      { label: 'Transferencia', value: 0 },
      { label: 'Nequi', value: 0 },
      { label: 'Bancolombia', value: 0 },
      { label: 'Daviplata', value: 0 },
      { label: 'Cortesía', value: 0 },
    ];

    return {
      closing: {
        id: 'CONSOLIDADO',
        shiftStart: start.toISOString(),
        shiftEnd: end.toISOString(),
        initialCash: finalInitial,
        totalCash: finalCash,
        totalTransfers: finalTransfers,
        totalNequi: finalNequi,
        totalBancolombia: finalBancolombia,
        totalDaviplata: finalDaviplata,
        totalSales: sumTotalSales || totalSalesValue,
        totalTips: sumTotalTips || totalTips,
        totalExpenses: sumTotalExpenses || totalExpenses,
        discrepancy: sumDiscrepancy,
        notes: 'Reporte Consolidado de todas las cajas del día.',
        user: { name: 'CONSOLIDADO' },
        cashRegister: { name: 'TODAS LAS CAJAS' },
      },
      transacciones: totalTransactions,
      valorTransacciones: totalSalesValue,
      propinas: totalTips,
      domicilios: totalDeliveryFees,
      inicialPorMetodo,
      ventasPorMetodo,
      impuestos: {
        nombre: 'INC (8%)',
        base: totalSubtotal,
        impuesto: totalTaxCalc,
      },
      gastos: {
        items: Object.entries(expensesByCategory).map(([tipo, total]) => ({ tipo, total })),
        total: totalExpenses,
      },
      resumen: {
        inicialMasVentasMasPropinas: initialPlusRevenue,
        pagosFacturas: 0,
        gastos: totalExpenses,
        totalEfectivo: totalCashMustHave,
        debeTener: totalCashMustHave,
        domicilios: totalDeliveryFees,
      },
    };
  }
}
