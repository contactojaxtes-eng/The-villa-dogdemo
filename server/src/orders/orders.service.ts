import { Prisma } from '@prisma/client';
import { lockOperation, operationTransaction } from '../common/operation-lock';
import { Injectable, NotFoundException, BadRequestException, Logger, ForbiddenException, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PrintService } from '../print/print.service';
import { dashboardRange } from './dashboard-range';

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
    private whatsappService: WhatsappService,
    @Inject(forwardRef(() => PrintService)) private printService: PrintService,
  ) {}

  private formatPaymentMethodName(pm?: string | null): string {
    if (!pm) return 'Efectivo';
    const upper = pm.trim().toUpperCase();
    if (upper === 'CASH') return 'Efectivo';
    if (upper === 'CORTESIA') return 'Cortesía';
    return 'Transferencia';
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'production') return;
    await this.ensureInvoiceNumbers();
    await this.cleanPickupAndLocalDrivers();
  }

  private async cleanPickupAndLocalDrivers() {
    try {
      const res = await this.prisma.order.updateMany({
        where: {
          orderType: { in: ['PICKUP', 'LOCAL'] },
          deliveryDriverId: { not: null },
        },
        data: {
          deliveryDriverId: null,
        },
      });
      if (res.count > 0) {
        this.logger.log(`🧹 Limpiados ${res.count} pedidos de tipo PICKUP/LOCAL que tenían domiciliario asignado.`);
      }
    } catch (e) {
      this.logger.warn('Error limpiando repartidores de pedidos para recoger/local:', e);
    }
  }

  private async ensureInvoiceNumbers() {
    try {
      const nullInvoiceOrders = await this.prisma.order.findMany({
        where: { invoiceNumber: null },
        orderBy: { createdAt: 'asc' },
      });

      if (nullInvoiceOrders.length === 0) return;

      const maxInvoiceOrder = await this.prisma.order.findFirst({
        where: { invoiceNumber: { not: null } },
        orderBy: { invoiceNumber: 'desc' },
      });

      let currentInvoice = maxInvoiceOrder?.invoiceNumber || 0;

      for (const order of nullInvoiceOrders) {
        currentInvoice++;
        await this.prisma.order.update({
          where: { id: order.id },
          data: { invoiceNumber: currentInvoice },
        });
      }
      this.logger.log(`✅ Asignados consecutivos de factura a ${nullInvoiceOrders.length} pedidos. Última factura: #${currentInvoice}`);
    } catch (err) {
      this.logger.error('Error al backfillear números de factura:', err);
    }
  }

  private isSendableWhatsAppPhone(phone?: string | null, orderType?: string, customerName?: string): boolean {
    if (!phone) return false;
    const trimmed = phone.trim();
    if (!trimmed) return false;

    // 1. Pedidos de mostrador / consumo local NUNCA envían mensajes de WhatsApp
    if (orderType === 'LOCAL' || customerName === 'Cliente Mostrador') {
      return false;
    }

    const clean = trimmed.replace(/\D/g, '');
    // 2. Ignorar comodines (3000000000, 0000000000, etc.) o teléfonos incompletos
    if (this.isDummyPhoneNumber(trimmed)) {
      return false;
    }

    return true;
  }

  private isDummyPhoneNumber(phone?: string | null): boolean {
    if (!phone) return true;
    const trimmed = phone.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith('@') || trimmed.startsWith('CO.')) return false;
    const clean = trimmed.replace(/\D/g, '');
    return clean === '3000000000' || clean === '0000000000' || /^0+$/.test(clean) || clean.length < 7;
  }

  private async sendOrderWhatsAppNotification(order: any, text: string) {
    if (!text || !order) return;
    try {
      // 1. Si la orden tiene chatSessionId directo, enviar DIRECTAMENTE a esa sesión sin crear nada nuevo
      if (order.chatSessionId) {
        const session = await this.prisma.whatsAppSession.findUnique({
          where: { id: order.chatSessionId },
        });
        if (session) {
          await this.whatsappService.sendDirectToSession(session.id, text);
          return;
        }
      }

      // 2. Si no tiene chatSessionId, buscar si existe sesión activa previa con este cliente o número
      const cleanP = (order.customerPhone || '').replace(/\D/g, '');
      const p10 = (cleanP.length === 12 && cleanP.startsWith('57')) ? cleanP.slice(2) : cleanP;
      if (p10 && p10 !== '3000000000' && p10 !== '0000000000') {
        const session = await this.prisma.whatsAppSession.findFirst({
          where: {
            OR: [
              { customerPhone: p10 },
              { customerPhone: `57${p10}` },
              { customerPhone: `+57${p10}` },
              { phone: order.customerPhone },
              { phone: p10 },
              { phone: `57${p10}` },
              { phone: `+57${p10}` },
              ...(order.customerName && !order.customerName.startsWith('@') && order.customerName !== 'Cliente Mostrador' && order.customerName !== 'Cliente Recoger' ? [{ customerName: { equals: order.customerName.trim(), mode: 'insensitive' as any } }] : [])
            ]
          },
          orderBy: { lastMessageAt: 'desc' }
        });
        if (session) {
          await this.whatsappService.sendDirectToSession(session.id, text);
          return;
        }
      }

      // 3. Fallback: Si no existe sesión previa en la BD, enviar al número de teléfono
      if (this.isSendableWhatsAppPhone(order.customerPhone, order.orderType, order.customerName)) {
        await this.whatsappService.sendMessage(order.customerPhone, text);
      }
    } catch (err) {
      this.logger.error(`Error enviando notificación WhatsApp para pedido #${order?.orderNumber}:`, err);
    }
  }

  async findAll(params: { status?: string; waiterId?: string; date?: string; startDate?: string; endDate?: string; search?: string; orderNumber?: number; paymentMethod?: string; paymentStatus?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.waiterId) where.waiterId = params.waiterId;
    if (params.paymentMethod) where.paymentMethod = params.paymentMethod;
    if (params.paymentStatus) where.paymentStatus = params.paymentStatus;
    if (params.orderNumber) where.orderNumber = params.orderNumber;
    if (params.startDate || params.endDate) {
      const startDateStr = params.startDate || '2020-01-01';
      const endDateStr = params.endDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      
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

      where.createdAt = { gte: start, lte: end };
    } else if (params.date) {
      if (params.date.length === 7) {
        const [year, month] = params.date.split('-').map(Number);
        const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const end = new Date(year, month, 0, 23, 59, 59, 999);
        where.createdAt = { gte: start, lte: end };
      } else {
        let start = new Date(`${params.date}T05:00:00.000-05:00`);
        let end = new Date(`${params.date}T04:59:59.999-05:00`);
        end.setDate(end.getDate() + 1);

        const shiftForDate = await this.prisma.cashClosing.findFirst({
          where: { shiftStart: { gte: new Date(`${params.date}T00:00:00.000-05:00`), lte: new Date(`${params.date}T23:59:59.999-05:00`) } },
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
        where.createdAt = { gte: start, lte: end };
      }
    }
    if (params.search) {
      const cleanSearch = params.search.trim();
      const digitsOnly = cleanSearch.replace(/\D/g, '');
      const searchNum = digitsOnly ? parseInt(digitsOnly, 10) : NaN;

      const searchConditions: any[] = [
        { customerName: { contains: cleanSearch, mode: 'insensitive' } },
        { customerPhone: { contains: cleanSearch, mode: 'insensitive' } },
        { customerAddress: { contains: cleanSearch, mode: 'insensitive' } },
        { addressReference: { contains: cleanSearch, mode: 'insensitive' } },
        { notes: { contains: cleanSearch, mode: 'insensitive' } },
      ];

      if (!isNaN(searchNum)) {
        searchConditions.push({ orderNumber: searchNum });
        searchConditions.push({ invoiceNumber: searchNum });
      }

      where.OR = searchConditions;
    }
    const queryOptions: any = {
      where,
      include: {
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
        zone: true,
        cashRegister: { select: { id: true, name: true } },
        items: { include: { menuItem: true } },
        payment: true,
        deliveryDriver: true,
      },
      orderBy: { createdAt: 'desc' },
    };

    // Si no hay filtro de fechas ni búsqueda, limitamos a 5000 pedidos por protección general
    // Si hay filtro de fechas (ej. Hoy, Ayer, Turno), trae TODOS los pedidos sin límite (200, 500, 1000+)
    if (!where.createdAt && !params.search) {
      queryOptions.take = 5000;
    }

    return this.prisma.order.findMany(queryOptions);
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        waiter: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
        zone: true,
        cashRegister: { select: { id: true, name: true } },
        items: { include: { menuItem: true } },
        payment: true,
        deliveryDriver: true,
        diningTable: true,
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  async findByNumber(orderNumber: number) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber },
      orderBy: { createdAt: 'desc' },
      include: {
        waiter: true,
        assignee: { select: { id: true, name: true } },
        zone: true,
        items: { include: { menuItem: true } },
        payment: true,
        deliveryDriver: true,
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  private todayRange() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { today, tomorrow };
  }

  async checkCanCreateOrders(userId: string, role: string) {
    if (['SUPERADMIN', 'ADMIN', 'WAITER'].includes(role)) {
      return { allowed: true, reason: null };
    }

    const openClosing = await this.prisma.cashClosing.findFirst({
      where: { userId, isOpen: true },
    });

    if (!openClosing) {
      const anyOpen = await this.prisma.cashClosing.findFirst({
        where: { isOpen: true },
      });
      if (anyOpen) {
        return { allowed: true, reason: null };
      }
      return { allowed: false, reason: 'No hay ninguna caja abierta. Debes abrir caja antes de tomar pedidos.' };
    }

    return { allowed: true, reason: null };
  }

  private async assertCashOpenForOrder(userId: string, role: string) {
    const check = await this.checkCanCreateOrders(userId, role);
    if (!check.allowed) {
      throw new BadRequestException(check.reason || 'Caja cerrada');
    }
  }

  async create(data: any) {
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      if (data.clientMutationId) {
        const existing = await tx.order.findUnique({ where: { clientMutationId: data.clientMutationId } });
        if (existing) {
          if (existing.waiterId !== (data.waiterId || null) || existing.customerPhone !== data.customerPhone) {
            throw new BadRequestException('El identificador del pedido ya está en uso');
          }
          return { order: existing, replay: true };
        }
      }
      return { order: await this.createWithinTransaction(data, tx), replay: false };
    }, operationTransaction);
    if (!result.replay) await this.notifyCreated(result.order);
    return result.order;
  }

  async createWithinTransaction(data: {
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    addressReference?: string;
    latitude?: number;
    longitude?: number;
    items: { menuItemId: string; quantity: number; notes?: string; isCourtesy?: boolean }[];
    waiterId: string;
    userId?: string;
    userRole?: string;
    zoneId?: string;
    zoneName?: string;
    notes?: string;
    paymentMethod?: string;
    cashAmount?: number;
    transferAmount?: number;
    paymentReference?: string;
    orderType?: string;
    source?: string;
    cashRegisterId?: string;
    assignedTo?: string;
    deliveryFee?: number;
    tax?: number;
    customerId?: string;
    chatSessionId?: string;
    tableId?: string;
    clientMutationId?: string;
  }, tx: Prisma.TransactionClient) {
    if (data.userId && data.userRole) {
      await this.assertCashOpenForOrder(data.userId, data.userRole);
    }

    if (!Array.isArray(data.items) || data.items.length > 100 || !data.items.length) {
      throw new BadRequestException('El pedido debe incluir al menos un producto');
    }
    for (const item of data.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100) {
        throw new BadRequestException('La cantidad de cada producto debe ser mayor a cero');
      }
    }

    if (data.customerPhone) {
      const raw = data.customerPhone.trim();
      const isId = /[^0-9+]/.test(raw) || raw.startsWith('@') || raw.startsWith('CO.') || raw.replace(/\D/g, '').length >= 13;
      if (isId) {
        data.customerPhone = raw;
      } else {
        const cleanPhone = raw.replace(/\D/g, '');
        const phone10 = cleanPhone.length === 12 && cleanPhone.startsWith('57') ? cleanPhone.slice(2) : cleanPhone;
        data.customerPhone = phone10.length === 10 ? phone10 : (cleanPhone || raw);
      }
    }

    // Auto-recuperación de teléfono real si llega 3000000000 o vacío en pedidos que no son de mostrador
    if (data.orderType !== 'LOCAL' && (!data.customerPhone || data.customerPhone === '3000000000' || data.customerPhone === '0000000000')) {
      if (data.customerId) {
        const cust = await tx.customer.findUnique({ where: { id: data.customerId } });
        if (cust?.phone && cust.phone !== '3000000000' && cust.phone !== '0000000000') {
          data.customerPhone = cust.phone;
        }
      }
      if ((!data.customerPhone || data.customerPhone === '3000000000') && data.customerName && data.customerName !== 'Cliente Mostrador' && data.customerName !== 'Cliente Recoger') {
        const custByName = await tx.customer.findFirst({
          where: { name: { equals: data.customerName.trim(), mode: 'insensitive' }, phone: { notIn: ['3000000000', '0000000000'] } }
        });
        if (custByName?.phone) {
          data.customerPhone = custByName.phone;
        } else {
          const session = await tx.whatsAppSession.findFirst({
            where: { customerName: { equals: data.customerName.trim(), mode: 'insensitive' }, customerPhone: { not: null } }
          });
          if (session?.customerPhone && session.customerPhone !== '3000000000') {
            const sc = session.customerPhone.replace(/\D/g, '');
            data.customerPhone = (sc.length === 12 && sc.startsWith('57')) ? sc.slice(2) : sc;
          }
        }
      }
    }

    const resolvedZoneId = await this.findOrCreateZone(data.zoneId, data.zoneName, data.deliveryFee);

    let cashRegisterId = data.cashRegisterId;
    if (!cashRegisterId) {
      let activeClosing = data.userId ? await tx.cashClosing.findFirst({
        where: { userId: data.userId, isOpen: true },
      }) : null;

      if (!activeClosing) {
        activeClosing = await tx.cashClosing.findFirst({
          where: { isOpen: true },
          orderBy: { shiftStart: 'desc' },
        });
      }

      if (activeClosing) {
        cashRegisterId = activeClosing.cashRegisterId || undefined;
      }
    }

    // Calcular el consecutivo de número de pedido (#1, #2, #3...)
    // Cada vez que se abre caja se reinicia el contador de pedidos (#1, #2, #3...) para el turno activo
    const bogotaDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const startOfDay = new Date(`${bogotaDateStr}T00:00:00.000-05:00`);

    let searchStart = startOfDay;
    const activeClosingForNum = await tx.cashClosing.findFirst({
      where: { isOpen: true },
      orderBy: { shiftStart: 'desc' },
    });
    if (activeClosingForNum && activeClosingForNum.shiftStart) {
      searchStart = activeClosingForNum.shiftStart;
    }

    const lastOrderToday = await tx.order.findFirst({
      where: {
        createdAt: {
          gte: searchStart,
        },
      },
      orderBy: { orderNumber: 'desc' },
    });
    const orderNumber = lastOrderToday ? lastOrderToday.orderNumber + 1 : 1;

    const totalOrderCount = await tx.order.count();
    const lastInvoiceOrder = await tx.order.findFirst({
      where: { invoiceNumber: { not: null } },
      orderBy: { invoiceNumber: 'desc' },
    });
    const invoiceNumber = Math.max(lastInvoiceOrder?.invoiceNumber || 0, totalOrderCount) + 1;

    const isCourtesy = data.paymentMethod === 'CORTESIA';
    let subtotal = 0;
    const orderItems: any[] = [];
    const menuItemIds = data.items.map(i => i.menuItemId);
    const menuItems = await tx.menuItem.findMany({ where: { id: { in: menuItemIds } } });
    const menuItemMap = new Map(menuItems.map(m => [m.id, m]));

    for (const item of data.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100) throw new BadRequestException('La cantidad de cada producto debe ser mayor a cero');
      const menuItem = menuItemMap.get(item.menuItemId);
      if (!menuItem || !menuItem.active) throw new BadRequestException(`Item ${item.menuItemId} no encontrado`);
      const itemIsCourtesy = isCourtesy || item.isCourtesy;
      const unitPrice = itemIsCourtesy ? 0 : menuItem.price;
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;
      orderItems.push({ 
        quantity: item.quantity, 
        unitPrice, 
        totalPrice, 
        notes: item.isCourtesy ? `[CORTESIA] ${item.notes || ''}`.trim() : item.notes, 
        menuItemId: item.menuItemId 
      });
    }

    const isPickupOrLocal = data.orderType === 'PICKUP' || data.orderType === 'LOCAL';
    let deliveryFee = 0;
    if (!isPickupOrLocal && !isCourtesy) {
      if (typeof data.deliveryFee === 'number') {
        deliveryFee = data.deliveryFee;
      } else if (resolvedZoneId) {
        const zone = await tx.deliveryZone.findUnique({ where: { id: resolvedZoneId } });
        if (zone) deliveryFee = zone.rate;
      }
    }

    if (!Number.isFinite(deliveryFee) || deliveryFee < 0) throw new BadRequestException('Tarifa de domicilio inválida');
    const tax = 0; // Los precios de los productos del menú ya incluyen el Impoconsumo (8%)
    const total = isCourtesy ? 0 : (subtotal + (isPickupOrLocal ? 0 : deliveryFee));

    let effectiveCustomerPhone = data.customerPhone;
    const digitsOnly = (data.customerPhone || '').replace(/\D/g, '');
    if (digitsOnly.length >= 13 || (data.customerPhone || '').startsWith('@')) {
      try {
        const session = await tx.whatsAppSession.findFirst({
          where: {
            OR: [
              { phone: data.customerPhone },
              { id: data.customerPhone },
              ...(data.customerName ? [{ customerName: data.customerName }] : [])
            ]
          }
        });
        if (session?.customerPhone) {
          const sDigits = session.customerPhone.replace(/\D/g, '');
          const s10 = (sDigits.length === 12 && sDigits.startsWith('57')) ? sDigits.slice(2) : sDigits;
          if (s10.length === 10 && s10.startsWith('3')) {
            effectiveCustomerPhone = s10;
          }
        }
      } catch {}
    }

    let resolvedCustomerId = data.customerId || null;
    if (!resolvedCustomerId && effectiveCustomerPhone && !this.isDummyPhoneNumber(effectiveCustomerPhone)) {
      const cleanP = effectiveCustomerPhone.replace(/\D/g, '');
      const p10 = (cleanP.length === 12 && cleanP.startsWith('57')) ? cleanP.slice(2) : cleanP;
      if (p10.length === 10 && p10.startsWith('3')) {
        try {
          let cust = await tx.customer.findUnique({ where: { phone: p10 } });
          if (!cust && data.customerName && data.customerName !== 'Cliente Mostrador' && data.customerName !== 'Cliente Recoger') {
            cust = await tx.customer.create({
              data: {
                name: data.customerName.trim(),
                phone: p10,
                address: data.customerAddress || null,
              }
            });
          } else if (cust && data.customerName && data.customerName !== 'Cliente Mostrador' && data.customerName !== 'Cliente Recoger' && (!cust.name || cust.name.startsWith('Cliente '))) {
            cust = await tx.customer.update({
              where: { id: cust.id },
              data: {
                name: data.customerName.trim(),
                address: data.customerAddress || cust.address,
              }
            });
          }
          if (cust) resolvedCustomerId = cust.id;
        } catch {}
      }
    }

    const order = await tx.order.create({
      data: {
        orderNumber,
        invoiceNumber,
        customerName: data.customerName,
        customerPhone: effectiveCustomerPhone,
        customerAddress: data.customerAddress,
        addressReference: isPickupOrLocal ? null : data.addressReference,
        latitude: isPickupOrLocal ? null : data.latitude,
        longitude: isPickupOrLocal ? null : data.longitude,
        notes: data.notes,
        subtotal, tax, deliveryFee: isPickupOrLocal ? 0 : deliveryFee, total,
        paymentMethod: data.paymentMethod || 'CASH',
        cashAmount: data.paymentMethod === 'MIXED' ? (data.cashAmount || 0) : (data.paymentMethod === 'CASH' ? total : 0),
        transferAmount: data.paymentMethod === 'MIXED' ? (data.transferAmount || 0) : (data.paymentMethod !== 'CASH' && data.paymentMethod !== 'CREDIT' && data.paymentMethod !== 'CORTESIA' ? total : 0),
        paymentReference: data.paymentReference,
        orderType: data.orderType || 'DELIVERY',
        source: data.source || 'MANUAL',
        waiterId: data.waiterId,
        zoneId: isPickupOrLocal ? null : resolvedZoneId,
        assignedTo: data.assignedTo || data.waiterId,
        cashRegisterId: cashRegisterId,
        customerId: resolvedCustomerId,
        chatSessionId: data.chatSessionId || null,
        tableId: data.tableId || null,
        clientMutationId: data.clientMutationId || null,
        items: { create: orderItems },
      },
      include: {
        items: { include: { menuItem: true } },
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        zone: true,
        cashRegister: { select: { id: true, name: true } },
        deliveryDriver: true,
        diningTable: true,
      },
    });

    if (data.chatSessionId) {
      try {
        await tx.whatsAppSession.update({
          where: { id: data.chatSessionId },
          data: {
            customerPhone: effectiveCustomerPhone,
            ...(data.customerName && !data.customerName.startsWith('@') && data.customerName !== 'Cliente Mostrador' && data.customerName !== 'Cliente Recoger' ? { customerName: data.customerName.trim() } : {})
          }
        });
      } catch {}
    }

    await tx.payment.create({
      data: {
        orderId: order.id,
        amount: total,
        method: data.paymentMethod || 'CASH',
        cashAmount: data.paymentMethod === 'MIXED' ? (data.cashAmount || 0) : (data.paymentMethod === 'CASH' ? total : 0),
        transferAmount: data.paymentMethod === 'MIXED' ? (data.transferAmount || 0) : (data.paymentMethod !== 'CASH' && data.paymentMethod !== 'CREDIT' && data.paymentMethod !== 'CORTESIA' ? total : 0),
        reference: data.paymentReference,
        status: data.paymentMethod === 'CASH' ? 'PENDING' : 'PENDING',
      },
    });

    return order;
  }

  async notifyCreated(order: any) {
    this.socketGateway.emitNewOrder(order);
    this.socketGateway.server.emit('whatsappSessionUpdated', { orderCreated: true, phone: order.customerPhone, orderNumber: order.orderNumber, status: order.status });

    try {
      if (this.isSendableWhatsAppPhone(order.customerPhone, order.orderType, order.customerName)) {
        const rawPhone = order.customerPhone.trim();
        const formatCOP = (val: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);

        const grouped = this.groupOrderItems(order.items || []);
        const itemsList = grouped.map(item => {
          const cleaned = this.cleanNotes(item.notes);
          const notesText = item.notes && cleaned && !item.notes.startsWith('Adición para:') ? ` (${cleaned})` : '';
          const itemTotal = (item.unitPrice || 0) * (item.quantity || 1);
          const priceText = itemTotal > 0 ? ` (${formatCOP(itemTotal)})` : '';
          let line = `• ${item.quantity}x ${item.menuItem?.name || 'Item'}${priceText}${notesText}`;
          if (item.additions && item.additions.length > 0) {
            const additionsText = item.additions.map(a => {
              const aCleaned = this.cleanNotes(a.notes);
              const aNotesText = a.notes && aCleaned && !a.notes.startsWith('Adición para:') ? ` (${aCleaned})` : '';
              const aTotal = (a.unitPrice || 0) * (a.quantity || 1);
              const aPriceText = aTotal > 0 ? ` (${formatCOP(aTotal)})` : '';
              return `\n  + ${a.quantity}x ${a.menuItem?.name || 'Item'}${aPriceText}${aNotesText}`;
            }).join('');
            line += additionsText;
          }
          return line;
        }).join('\n');

        let text = '';
        const pmText = this.formatPaymentMethodName(order.paymentMethod);
        if (order.orderType === 'DELIVERY') {
          text = `¡Hola ${order.customerName}! Tu pedido #${order.orderNumber} en The Villa Dog ha sido recibido y está siendo preparado.\n\n` +
            `*Detalle de tu pedido:*\n${itemsList}\n\n` +
            `Valor del pedido: ${formatCOP(order.subtotal)}\n` +
            (order.deliveryFee > 0 ? `Domicilio: ${formatCOP(order.deliveryFee)}\n` : '') +
            `*Total a pagar: ${formatCOP(order.total)}*\n` +
            `*Método de pago:* ${pmText}\n\n` +
            `Te avisaremos apenas tu pedido salga en camino.`;
        } else if (order.orderType === 'PICKUP') {
          text = `¡Hola ${order.customerName}! Tu pedido #${order.orderNumber} (para retirar) en The Villa Dog ha sido recibido y está siendo preparado.\n\n` +
            `*Detalle de tu pedido:*\n${itemsList}\n\n` +
            `*Total a pagar: ${formatCOP(order.total)}*\n` +
            `*Método de pago:* ${pmText}\n\n` +
            `¡Te avisaremos apenas esté listo para que pases a retirarlo por el restaurante!`;
        }

        if (text) {
          await this.sendOrderWhatsAppNotification(order, text);
        }
      }
    } catch (waErr) {
      this.logger.error('Error enviando WhatsApp automático', waErr);
    }

    try {
      const printerSettings = await this.printService.getPrinterSettings();
      if (printerSettings?.autoPrint === true) {
        const fullOrder = await this.prisma.order.findUnique({
          where: { id: order.id },
          include: {
            items: { include: { menuItem: { include: { category: true } } } },
            zone: true,
            assignee: { select: { name: true } },
            waiter: { select: { name: true } },
            deliveryDriver: { select: { id: true, name: true, phone: true } },
          },
        });
        if (fullOrder) {
          for (const p of printerSettings.printers || []) {
            if (p.enabled === false || p.type === 'caja') continue;
            const ticketText = this.printService.formatCocinaTicketText(
              fullOrder,
              p.name,
              p.categories,
              printerSettings.printers,
              p.paper
            );
            let targetIp = (p.ip || '').trim();
            if (!targetIp) continue;
            if (ticketText) {
              const buffer = this.printService.buildEscPos(ticketText, p.paper);
              const payload = buffer.toString('base64');
              await this.prisma.printJob.create({
                data: {
                  impresoraIp: targetIp,
                  payload,
                  tipo: p.id || p.name,
                },
              });
            }
          }
        }
      }
    } catch (printErr) {
      this.logger.warn('Error en auto-impresión de comandas de cocina/pizzas:', printErr);
    }

    return order;
  }

  async update(id: string, data: any) {
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const order = await tx.order.findUnique({ where: { id } });
      if (order?.tableId) throw new BadRequestException('Edita este pedido desde su cuenta en Mesas');
      return this.updateWithinTransaction(id, data, tx);
    }, operationTransaction);
    await this.notifyUpdated(id, result.updated, result.existing, data);
    return result.updated;
  }

  async updateWithinTransaction(id: string, data: {
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    addressReference?: string;
    latitude?: number;
    longitude?: number;
    items: { menuItemId: string; quantity: number; notes?: string; isCourtesy?: boolean }[];
    zoneId?: string;
    zoneName?: string;
    notes?: string;
    paymentMethod?: string;
    paymentReference?: string;
    orderType?: string;
    deliveryFee?: number;
    tax?: number;
    customerId?: string;
  }, tx: Prisma.TransactionClient) {
    const existing = await tx.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Pedido no encontrado');
    if (['CONFIRMED', 'PENDING_REVIEW'].includes(existing.paymentStatus)) throw new BadRequestException('No se puede editar un pedido pagado o con comprobante en revisión');
    if (existing.status === 'CANCELLED') throw new BadRequestException('No se puede editar un pedido cancelado');
    if (existing.status === 'DELIVERED') throw new BadRequestException('No se puede editar un pedido entregado');

    if (!data.items?.length) {
      throw new BadRequestException('El pedido debe incluir al menos un producto');
    }
    for (const item of data.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100) {
        throw new BadRequestException('La cantidad de cada producto debe ser mayor a cero');
      }
    }

    if (data.customerPhone) {
      const raw = data.customerPhone.trim();
      const isId = /[^0-9+]/.test(raw) || raw.startsWith('@') || raw.startsWith('CO.') || raw.replace(/\D/g, '').length >= 13;
      if (isId) {
        data.customerPhone = raw;
      } else {
        const cleanPhone = raw.replace(/\D/g, '');
        const phone10 = cleanPhone.length === 12 && cleanPhone.startsWith('57') ? cleanPhone.slice(2) : cleanPhone;
        data.customerPhone = phone10.length === 10 ? phone10 : (cleanPhone || raw);
      }
    }

    // Auto-recuperación de teléfono real si llega 3000000000 o vacío en pedidos que no son de mostrador
    if (data.orderType !== 'LOCAL' && (!data.customerPhone || data.customerPhone === '3000000000' || data.customerPhone === '0000000000')) {
      if (data.customerId) {
        const cust = await tx.customer.findUnique({ where: { id: data.customerId } });
        if (cust?.phone && cust.phone !== '3000000000' && cust.phone !== '0000000000') {
          data.customerPhone = cust.phone;
        }
      }
      if ((!data.customerPhone || data.customerPhone === '3000000000') && data.customerName && data.customerName !== 'Cliente Mostrador' && data.customerName !== 'Cliente Recoger') {
        const custByName = await tx.customer.findFirst({
          where: { name: { equals: data.customerName.trim(), mode: 'insensitive' }, phone: { notIn: ['3000000000', '0000000000'] } }
        });
        if (custByName?.phone) {
          data.customerPhone = custByName.phone;
        } else {
          const session = await tx.whatsAppSession.findFirst({
            where: { customerName: { equals: data.customerName.trim(), mode: 'insensitive' }, customerPhone: { not: null } }
          });
          if (session?.customerPhone && session.customerPhone !== '3000000000') {
            const sc = session.customerPhone.replace(/\D/g, '');
            data.customerPhone = (sc.length === 12 && sc.startsWith('57')) ? sc.slice(2) : sc;
          }
        }
      }
    }

    const resolvedZoneId = await this.findOrCreateZone(data.zoneId, data.zoneName, data.deliveryFee);

    const isCourtesy = data.paymentMethod === 'CORTESIA';
    let subtotal = 0;
    const orderItems: any[] = [];
    const menuItemIds = data.items.map(i => i.menuItemId);
    const menuItems = await tx.menuItem.findMany({ where: { id: { in: menuItemIds } } });
    const menuItemMap = new Map(menuItems.map(m => [m.id, m]));

    for (const item of data.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100) throw new BadRequestException('La cantidad de cada producto debe ser mayor a cero');
      const menuItem = menuItemMap.get(item.menuItemId);
      if (!menuItem || !menuItem.active) throw new BadRequestException(`Item ${item.menuItemId} no encontrado`);
      const itemIsCourtesy = isCourtesy || item.isCourtesy;
      const unitPrice = itemIsCourtesy ? 0 : menuItem.price;
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;
      orderItems.push({
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        notes: item.isCourtesy ? `[CORTESIA] ${item.notes || ''}`.trim() : item.notes,
        menuItemId: item.menuItemId,
      });
    }

    const isPickupOrLocal = data.orderType === 'PICKUP' || data.orderType === 'LOCAL';
    let deliveryFee = 0;
    if (!isPickupOrLocal && !isCourtesy) {
      if (typeof data.deliveryFee === 'number') {
        deliveryFee = data.deliveryFee;
      } else if (resolvedZoneId) {
        const zone = await tx.deliveryZone.findUnique({ where: { id: resolvedZoneId } });
        if (zone) deliveryFee = zone.rate;
      }
    }

    const tax = 0; // Los precios de los productos del menú ya incluyen el Impoconsumo (8%)
    const total = isCourtesy ? 0 : (subtotal + (isPickupOrLocal ? 0 : deliveryFee));

    let resolvedCustomerId = data.customerId || existing.customerId || null;
    if (!resolvedCustomerId && data.customerPhone && !this.isDummyPhoneNumber(data.customerPhone)) {
      const cleanP = data.customerPhone.replace(/\D/g, '');
      const p10 = (cleanP.length === 12 && cleanP.startsWith('57')) ? cleanP.slice(2) : cleanP;
      if (p10.length === 10 && p10.startsWith('3')) {
        try {
          let cust = await tx.customer.findUnique({ where: { phone: p10 } });
          if (!cust && data.customerName && data.customerName !== 'Cliente Mostrador' && data.customerName !== 'Cliente Recoger') {
            cust = await tx.customer.create({
              data: {
                name: data.customerName.trim(),
                phone: p10,
                address: data.customerAddress || null,
              }
            });
          } else if (cust && data.customerName && data.customerName !== 'Cliente Mostrador' && data.customerName !== 'Cliente Recoger' && (!cust.name || cust.name.startsWith('Cliente '))) {
            cust = await tx.customer.update({
              where: { id: cust.id },
              data: {
                name: data.customerName.trim(),
                address: data.customerAddress || cust.address,
              }
            });
          }
          if (cust) resolvedCustomerId = cust.id;
        } catch {}
      }
    }

    const updated = await (async () => {
      // Eliminar items viejos
      await tx.orderItem.deleteMany({ where: { orderId: id } });

      // Actualizar pedido
      const order = await tx.order.update({
        where: { id },
        data: {
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          customerAddress: data.customerAddress,
          addressReference: isPickupOrLocal ? null : (data.addressReference ?? null),
          latitude: isPickupOrLocal ? null : (data.latitude ?? null),
          longitude: isPickupOrLocal ? null : (data.longitude ?? null),
          notes: data.notes ?? null,
          subtotal,
          tax,
          deliveryFee: isPickupOrLocal ? 0 : deliveryFee,
          total,
          paymentMethod: data.paymentMethod || 'CASH',
          paymentReference: data.paymentReference ?? null,
          orderType: data.orderType || 'DELIVERY',
          zoneId: isPickupOrLocal ? null : (resolvedZoneId ?? null),
          deliveryDriverId: isPickupOrLocal ? null : existing.deliveryDriverId,
          customerId: resolvedCustomerId,
          items: {
            create: orderItems,
          },
        },
        include: {
          items: { include: { menuItem: true } },
          waiter: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
          zone: true,
          cashRegister: { select: { id: true, name: true } },
          payment: true,
          deliveryDriver: true,
        },
      });

      // Actualizar pago
      await tx.payment.updateMany({
        where: { orderId: id },
        data: {
          amount: total,
          method: data.paymentMethod || 'CASH',
          reference: data.paymentReference ?? null,
        },
      });

      return order;
    })();

    return { updated, existing };
  }

  async notifyUpdated(id: string, updated: any, existing: any, data: any) {
    this.socketGateway.emitOrderStatusChange(id, updated.status, updated);

    try {
      if (this.isSendableWhatsAppPhone(updated.customerPhone, updated.orderType, updated.customerName)) {
        const rawPhone = updated.customerPhone.trim();
        const formatCOP = (val: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);

        const grouped = this.groupOrderItems(updated.items || []);
        const itemsList = grouped.map(item => {
          const cleaned = this.cleanNotes(item.notes);
          const notesText = item.notes && cleaned && !item.notes.startsWith('Adición para:') ? ` (${cleaned})` : '';
          let line = `• ${item.quantity}x ${item.menuItem?.name || 'Item'}${notesText}`;
          if (item.additions && item.additions.length > 0) {
            const additionsText = item.additions.map(a => {
              const aCleaned = this.cleanNotes(a.notes);
              const aNotesText = a.notes && aCleaned && !a.notes.startsWith('Adición para:') ? ` (${aCleaned})` : '';
              return `\n  + ${a.quantity}x ${a.menuItem?.name || 'Item'}${aNotesText}`;
            }).join('');
            line += additionsText;
          }
          return line;
        }).join('\n');

        let text = '';
        const pmText = this.formatPaymentMethodName(updated.paymentMethod);
        if (updated.orderType === 'DELIVERY') {
          text = `¡Hola ${updated.customerName}! Tu pedido #${updated.orderNumber} en The Villa Dog ha sido actualizado.\n\n` +
            `*Detalle actualizado de tu pedido:*\n${itemsList}\n\n` +
            `Valor del pedido: ${formatCOP(updated.subtotal)}\n` +
            (updated.deliveryFee > 0 ? `Domicilio: ${formatCOP(updated.deliveryFee)}\n` : '') +
            `*Nuevo total a pagar: ${formatCOP(updated.total)}*\n` +
            `*Método de pago:* ${pmText}`;
        } else if (updated.orderType === 'PICKUP') {
          text = `¡Hola ${updated.customerName}! Tu pedido #${updated.orderNumber} (para retirar) en The Villa Dog ha sido actualizado.\n\n` +
            `*Detalle actualizado de tu pedido:*\n${itemsList}\n\n` +
            `*Nuevo total a pagar: ${formatCOP(updated.total)}*\n` +
            `*Método de pago:* ${pmText}`;
        }

        if (text) {
          await this.sendOrderWhatsAppNotification(updated, text);
        }
      }
    } catch (waErr) {
      this.logger.error(`Error enviando WhatsApp de edición para pedido #${updated.orderNumber}`, waErr);
    }

    // Detectar si los items realmente cambiaron antes de auto-imprimir comanda editada
    const oldItemsSignature = (existing.items || [])
      .map(i => `${i.menuItemId}:${i.quantity}:${(i.notes || '').trim()}`)
      .sort()
      .join('|');
    const newItemsSignature = (data.items || [])
      .map(i => `${i.menuItemId}:${i.quantity}:${(i.notes || '').trim()}`)
      .sort()
      .join('|');
    const itemsActuallyChanged = oldItemsSignature !== newItemsSignature;

    try {
      if (itemsActuallyChanged) {
        const printerSettings = await this.printService.getPrinterSettings();
        if (printerSettings?.autoPrint === true) {
          const fullOrder = await this.prisma.order.findUnique({
            where: { id: updated.id },
            include: {
              items: { include: { menuItem: { include: { category: true } } } },
              zone: true,
              assignee: { select: { name: true } },
              waiter: { select: { name: true } },
              deliveryDriver: { select: { id: true, name: true, phone: true } },
            },
          });
          if (fullOrder) {
            (fullOrder as any).isEdited = true;
            for (const p of printerSettings.printers || []) {
              if (p.enabled === false || p.type === 'caja') continue;
              const ticketText = this.printService.formatCocinaTicketText(
                fullOrder,
                p.name,
                p.categories,
                printerSettings.printers,
                p.paper
              );
              let targetIp = (p.ip || '').trim();
              if (!targetIp) continue;
              if (ticketText) {
                const buffer = this.printService.buildEscPos(ticketText, p.paper);
                const payload = buffer.toString('base64');
                await this.prisma.printJob.create({
                  data: {
                    impresoraIp: targetIp,
                    payload,
                    tipo: p.id || p.name,
                  },
                });
              }
            }
          }
        }
      } else {
        this.logger.log(`Pedido #${updated.orderNumber} actualizado sin cambios en items – NO se reimprime comanda.`);
      }
    } catch (printErr) {
      this.logger.warn('Error en auto-impresión de comanda modificada:', printErr);
    }

    return updated;
  }

  async updateStatus(id: string, status: string, user?: { id: string; role: string }, deliveryDriverId?: string) {
    const validStatuses = ['PENDING', 'READY', 'IN_ROUTE', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status)) throw new BadRequestException('Estado inválido');

    const order = await this.findOne(id);

    // Block driver changes on completed or cancelled orders
    if (['DELIVERED', 'CANCELLED'].includes(order.status) && deliveryDriverId !== undefined && deliveryDriverId !== order.deliveryDriverId) {
      throw new BadRequestException('No se puede cambiar el repartidor a un pedido que ya fue entregado o cancelado.');
    }

    const targetDriverId = deliveryDriverId !== undefined ? deliveryDriverId : order.deliveryDriverId;

    // Block IN_ROUTE if delivery order has no driver assigned
    if (status === 'IN_ROUTE' && order.orderType === 'DELIVERY' && !targetDriverId) {
      throw new BadRequestException('No se puede poner en ruta un pedido de domicilio sin domiciliario asignado.');
    }

    if (targetDriverId && status === 'IN_ROUTE') {
      const activeCount = await this.prisma.order.count({
        where: {
          deliveryDriverId: targetDriverId,
          status: 'IN_ROUTE',
          id: { not: id },
        },
      });
      if (activeCount >= 5) {
        throw new BadRequestException('El domiciliario ha alcanzado el límite máximo de 5 pedidos activos (En Ruta). Confirma el cobro de alguno antes de asignarle más.');
      }
    }

    const isPickupOrLocal = order.orderType === 'PICKUP' || order.orderType === 'LOCAL';
    const dataUpdate: any = { status };
    if (isPickupOrLocal) {
      dataUpdate.deliveryDriverId = null;
    } else if (deliveryDriverId !== undefined) {
      dataUpdate.deliveryDriverId = deliveryDriverId || null;
    }

    if (order.status === status && deliveryDriverId === undefined) return order;

    if (user) {
      if (user.role === 'DELIVERY_MANAGER') {
        if (!['IN_ROUTE', 'DELIVERED'].includes(status)) {
          throw new ForbiddenException('No tienes permiso para establecer este estado');
        }
        if (order.assignedTo !== user.id) {
          throw new ForbiddenException('No estás asignado a este pedido');
        }
      }
    }

    if (status === 'DELIVERED' && order.status === 'CANCELLED') {
      throw new BadRequestException('No se puede entregar un pedido cancelado');
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: dataUpdate,
      include: {
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, phone: true } },
        zone: true,
        items: { include: { menuItem: true } },
        payment: true,
        deliveryDriver: { select: { id: true, name: true, phone: true } },
      },
    });

    if (status === 'DELIVERED') {
      await this.prisma.payment.updateMany({
        where: { orderId: id },
        data: { status: order.paymentMethod === 'CASH' ? 'CONFIRMED' : undefined },
      });
      if (order.paymentMethod !== 'CASH') {
        await this.prisma.order.update({ where: { id }, data: { paymentStatus: 'CONFIRMED' } });
      }
    }

    this.socketGateway.emitOrderStatusChange(id, status, updated);
    this.socketGateway.server.emit('whatsappSessionUpdated', { orderUpdated: true, phone: updated.customerPhone, orderNumber: updated.orderNumber, status: updated.status });

    try {
      if (this.isSendableWhatsAppPhone(updated.customerPhone, updated.orderType, updated.customerName)) {
        const rawPhone = updated.customerPhone.trim();
        let text = '';
        if (status === 'READY' && updated.orderType === 'PICKUP') {
          text = `¡Tu pedido ya está listo!\n\nPuedes pasar a recogerlo en nuestro punto de domicilios. 🛵\n¡Te esperamos!`;
        } else if (status === 'IN_ROUTE' && updated.orderType === 'DELIVERY') {
          const driver: any = updated.deliveryDriver || updated.assignee;
          const driverInfo = driver?.name ? `con tu domiciliario ${driver.name}` : 'con el domiciliario';
          const driverPhoneInfo = driver?.phone ? ` (${driver.phone})` : '';
          text = `¡Hola ${updated.customerName}! Tu pedido ya va en camino ${driverInfo}${driverPhoneInfo}. ¡Gracias por tu compra en The Villa Dog!`;
        } else if (status === 'DELIVERED') {
          text = `¡Hola ${updated.customerName}! Tu pedido ha sido entregado con éxito. ¡Gracias por tu compra y buen provecho!`;
        }

        if (text) {
          await this.sendOrderWhatsAppNotification(updated, text);
        }
        if (status === 'DELIVERED') {
          await this.whatsappService.unassignSessionByPhone(updated.customerPhone);
        }
      }
    } catch (waErr) {
      this.logger.error(`Error enviando WhatsApp de actualización para pedido #${updated.orderNumber}`, waErr);
    }

    return updated;
  }

  async cancelOrder(id: string, reason: string, userParam: any) {
    const userId = typeof userParam === 'string' ? userParam : userParam?.id;
    const userRole = typeof userParam === 'object' ? userParam?.role : null;

    if (userRole === 'DELIVERY_MANAGER') {
      throw new ForbiddenException('Los gestores de domicilios no tienen permiso para cancelar pedidos');
    }

    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === 'CANCELLED') throw new BadRequestException('Pedido ya cancelado');
    if (order.status === 'DELIVERED') throw new BadRequestException('No se puede cancelar un pedido entregado');

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: new Date(),
        cancelledById: userId,
        paymentStatus: 'REJECTED',
      },
      include: {
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
        zone: true,
        items: { include: { menuItem: true } },
        payment: true,
      },
    });

    await this.prisma.payment.updateMany({
      where: { orderId: id },
      data: { status: 'REJECTED' },
    });
    if (order.tableId) {
      await this.prisma.kitchenTicket.updateMany({
        where: { orderId: id },
        data: { status: 'CANCELLED', changeSummary: `Cancelado: ${reason || 'Por mesero'}` },
      });
      const tickets = await this.prisma.kitchenTicket.findMany({
        where: { orderId: id },
        include: { station: { include: { users: { select: { id: true, name: true, role: true } } } }, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
      });
      for (const t of tickets) {
        this.socketGateway.emitKitchenTicketUpdated(t);
      }
      const table = await this.prisma.diningTable.findUnique({
        where: { id: order.tableId },
        include: { openedBy: true, orders: { include: { items: true, kitchenTickets: true } } },
      });
      if (table) {
        this.socketGateway.emitTableUpdated(table);
      }
    }

    this.socketGateway.emitOrderStatusChange(id, 'CANCELLED', updated);

    try {
      if (this.isSendableWhatsAppPhone(updated.customerPhone, updated.orderType, updated.customerName)) {
        const text = `Hola ${updated.customerName}. Te informamos que tu pedido #${updated.orderNumber} ha sido cancelado.\nMotivo: ${reason || 'No especificado'}.`;
        await this.sendOrderWhatsAppNotification(updated, text);
      }
    } catch (waErr) {
      this.logger.error(`Error enviando WhatsApp de cancelación para pedido #${updated.orderNumber}`, waErr);
    }

    if (order.status !== 'IN_ROUTE' && order.status !== 'DELIVERED') {
      try {
        await this.printService.printCancellation(updated);
      } catch (err) {
        this.logger.error(`Error imprimiendo ticket de cancelación para pedido #${updated.orderNumber}`, err);
      }
    }

    return updated;
  }

  async assignOperator(orderId: string, operatorId: string | null, operatorName: string | null) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { assignedTo: operatorId },
      include: {
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        zone: true,
        items: { include: { menuItem: true } },
      },
    });

    this.socketGateway.emitOrderAssigned(orderId, operatorId, operatorName, updated);
    return updated;
  }

  async rateOrder(id: string, rating: number) {
    if (rating < 1 || rating > 5) throw new BadRequestException('Rating debe ser entre 1 y 5');
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return this.prisma.order.update({ where: { id }, data: { rated: true, rating } });
  }

  async updatePayment(
    id: string, 
    method: string, 
    paymentStatus: string, 
    reference?: string, 
    user?: { id: string; role: string }, 
    customerId?: string, 
    courtesyItemIds?: string[],
    cashAmount?: number,
    transferAmount?: number
  ) {
    const order = await this.findOne(id);

    // Si se especificaron productos individuales para Cortesía
    if (courtesyItemIds && courtesyItemIds.length > 0) {
      for (const itemId of courtesyItemIds) {
        await this.prisma.orderItem.updateMany({
          where: { id: itemId, orderId: id },
          data: { unitPrice: 0, totalPrice: 0 },
        });
      }
      const allItems = await this.prisma.orderItem.findMany({ where: { orderId: id } });
      const newSubtotal = allItems.reduce((sum, item) => sum + item.totalPrice, 0);
      const newTotal = newSubtotal + (order.deliveryFee || 0) + (order.tax || 0) + (order.tip || 0);
      await this.prisma.order.update({
        where: { id },
        data: { subtotal: newSubtotal, total: newTotal }
      });
    } else if (method === 'CORTESIA') {
      await this.prisma.orderItem.updateMany({
        where: { orderId: id },
        data: { unitPrice: 0, totalPrice: 0 },
      });
      await this.prisma.order.update({
        where: { id },
        data: { subtotal: 0, total: 0 }
      });
    }

    let targetCustomerId = customerId || order.customerId;
    if (method === 'CREDIT' && !targetCustomerId && order.customerPhone) {
      const cleanPhone = order.customerPhone.replace(/\D/g, '');
      if (cleanPhone) {
        let existingCust = await this.prisma.customer.findUnique({ where: { phone: cleanPhone } });
        if (!existingCust) {
          existingCust = await this.prisma.customer.create({
            data: {
              name: order.customerName || 'Cliente Crédito',
              phone: cleanPhone,
              address: order.customerAddress || null,
            }
          });
        }
        targetCustomerId = existingCust.id;
      }
    }

    let cashRegisterId: string | undefined = undefined;
    let confirmedBy: string | undefined = undefined;

    if (user) {
      confirmedBy = user.id;
      const activeClosing = await this.prisma.cashClosing.findFirst({
        where: { userId: user.id, isOpen: true },
      });
      if (activeClosing) {
        cashRegisterId = activeClosing.cashRegisterId || undefined;
      }
    }

    const currentTotal = (courtesyItemIds && courtesyItemIds.length > 0) || method === 'CORTESIA' 
      ? (await this.prisma.order.findUnique({ where: { id } }))?.total || 0 
      : order.total;

    let finalCash = 0;
    let finalTransfer = 0;
    if (method === 'MIXED') {
      finalCash = Number(cashAmount || 0);
      finalTransfer = Number(transferAmount || 0);
    } else if (method === 'CASH') {
      finalCash = currentTotal;
      finalTransfer = 0;
    } else if (method !== 'CREDIT' && method !== 'CORTESIA') {
      finalCash = 0;
      finalTransfer = currentTotal;
    }

    await this.prisma.payment.updateMany({
      where: { orderId: id },
      data: { 
        method, 
        cashAmount: finalCash,
        transferAmount: finalTransfer,
        status: paymentStatus, 
        reference,
        ...(confirmedBy && paymentStatus === 'CONFIRMED' ? { confirmedBy, confirmedAt: new Date() } : {})
      },
    });
    const updated = await this.prisma.order.update({
      where: { id },
      data: { 
        paymentMethod: method, 
        cashAmount: finalCash,
        transferAmount: finalTransfer,
        paymentStatus, 
        paymentReference: reference,
        ...(targetCustomerId ? { customerId: targetCustomerId } : {}),
        ...(cashRegisterId && paymentStatus === 'CONFIRMED' ? { cashRegisterId } : {})
      },
      include: {
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
        zone: true,
        cashRegister: { select: { id: true, name: true } },
        items: { include: { menuItem: true } },
        payment: true,
        deliveryDriver: { select: { id: true, name: true, phone: true } },
      },
    });

    if (paymentStatus === 'CONFIRMED') {
      return this.updateStatus(id, 'DELIVERED', user);
    }

    this.socketGateway.emitOrderStatusChange(id, updated.status, updated);
    return updated;
  }

  async getActiveOrders() {
    return this.prisma.order.findMany({
      where: {
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
        tableId: null,
      },
      include: {
        waiter: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        zone: true,
        items: { include: { menuItem: true } },
        deliveryDriver: true,
        cashRegister: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getTodayStats() {
    const activeClosing = await this.prisma.cashClosing.findFirst({
      where: { isOpen: true },
      orderBy: { shiftStart: 'desc' },
    });

    let whereClause: any = {};

    if (activeClosing && activeClosing.shiftStart) {
      whereClause = { createdAt: { gte: activeClosing.shiftStart } };
    } else {
      const lastClosing = await this.prisma.cashClosing.findFirst({
        orderBy: { shiftEnd: 'desc' },
      });
      if (lastClosing && lastClosing.shiftEnd) {
        whereClause = { createdAt: { gte: lastClosing.shiftEnd } };
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        whereClause = { createdAt: { gte: today } };
      }
    }

    const orders = await this.prisma.order.findMany({
      where: whereClause,
    });

    const activeOrders = orders.filter(o => o.status !== 'CANCELLED');
    const deliveredOrders = activeOrders.filter(o => o.status === 'DELIVERED');

    const totalOrders = activeOrders.length;
    const totalSales = deliveredOrders.reduce((sum, o) => sum + o.total, 0);
    const totalTips = deliveredOrders.reduce((sum, o) => sum + (o.tip || 0), 0);
    const delivered = deliveredOrders.length;
    const cancelledOrders = orders.filter(o => o.status === 'CANCELLED').length;
    const pendingOrders = activeOrders.filter(o => !['DELIVERED'].includes(o.status)).length;

    const sumByMethod = (method: string) =>
      deliveredOrders.filter(o => o.paymentMethod === method).reduce((sum, o) => sum + o.total, 0);

    return {
      totalOrders,
      totalSales,
      totalTips,
      deliveredOrders: delivered,
      cancelledOrders,
      pendingOrders,
      totalCash: sumByMethod('CASH'),
      totalTransfers: sumByMethod('TRANSFER'),
      totalNequi: sumByMethod('NEQUI'),
      totalBancolombia: sumByMethod('BANCOLOMBIA'),
      totalDaviplata: sumByMethod('DAVIPLATA'),
    };
  }

  async getDashboardStats(startDate?: string, endDate?: string) {
    const { start, end, from, until } = dashboardRange(startDate, endDate);
    const createdAt = { gte: from, lt: until };
    // Aggregate in PostgreSQL: never load the entire order history into memory.
    const [groups, sales, openTables, kitchenPending, pendingPayments, activeDeliveries, openRegisters] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where: { createdAt }, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { createdAt, status: 'DELIVERED', paymentStatus: 'CONFIRMED' }, _sum: { total: true } }),
      this.prisma.diningTable.count({ where: { status: 'OPEN', orders: { some: {} } } }),
      this.prisma.kitchenTicket.count({ where: { status: { in: ['NEW', 'PREPARING'] } } }),
      this.prisma.payment.count({ where: { status: { in: ['PENDING', 'PENDING_REVIEW'] }, order: { orderType: 'LOCAL', status: { not: 'CANCELLED' } } } }),
      this.prisma.order.count({ where: { orderType: 'DELIVERY', status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
      this.prisma.cashClosing.count({ where: { isOpen: true } }),
    ]);
    const count = (status: string) => groups.find(group => group.status === status)?._count._all || 0;
    const orders = groups.reduce((sum, group) => sum + group._count._all, 0);
    return {
      range: { start, end },
      today: { orders, delivered: count('DELIVERED'), cancelled: count('CANCELLED'), pending: orders - count('DELIVERED') - count('CANCELLED'), sales: sales._sum.total || 0 },
      operation: { openTables, kitchenPending, pendingPayments, activeDeliveries, openRegisters },
    };
  }

  async getCustomerHistory(phone: string) {
    const raw = (phone || '').trim();
    const cleanDigits = raw.replace(/\D/g, '');
    const phone10 = cleanDigits.slice(-10);
    
    const orConditions: any[] = [{ customerPhone: { equals: raw, mode: 'insensitive' } }];
    if (phone10 && phone10.length >= 7) {
      orConditions.push({ customerPhone: { contains: phone10 } });
    }
    if (cleanDigits && cleanDigits.length >= 7 && cleanDigits !== phone10) {
      orConditions.push({ customerPhone: { contains: cleanDigits } });
    }

    return this.prisma.order.findMany({
      where: { OR: orConditions },
      include: { items: { include: { menuItem: true } }, zone: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  private async findOrCreateZone(zoneId?: string, zoneName?: string, deliveryFee?: number): Promise<string | undefined> {
    if (zoneId) {
      const zone = await this.prisma.deliveryZone.findUnique({ where: { id: zoneId } });
      if (zone) return zone.id;
    }
    if (zoneName && zoneName.trim()) {
      const trimmedName = zoneName.trim();
      const zone = await this.prisma.deliveryZone.findFirst({
        where: {
          name: {
            equals: trimmedName,
            mode: 'insensitive',
          },
          active: true,
        },
      });
      if (zone) return zone.id;
    }
    return undefined;
  }

  private cleanNotes(notes?: string | null): string {
    if (!notes) return '';
    return notes.replace(/\s*\(#[\w-]+\)/g, '').trim();
  }

  private groupOrderItems(items: any[]): any[] {
    const baseItems: any[] = [];
    const additions: any[] = [];

    for (const item of items) {
      const notesStr = item.notes || '';
      if (notesStr.startsWith('Adición para:')) {
        additions.push(item);
      } else {
        baseItems.push({ ...item, additions: [] });
      }
    }

    for (const add of additions) {
      const notesStr = add.notes || '';
      const tagMatch = notesStr.match(/\(#[\w-]+\)/);
      let parent: any = null;

      if (tagMatch) {
        const tag = tagMatch[0];
        parent = baseItems.find(bi => (bi.notes || '').includes(tag));
      }

      if (!parent) {
        const parentName = notesStr.replace('Adición para:', '').replace(/\s*\(#[\w-]+\)/g, '').trim().toLowerCase();
        parent = baseItems.find(bi => {
          const name = bi.menuItem?.name || bi.name || '';
          return name.toLowerCase().trim() === parentName;
        });
      }

      if (parent) {
        parent.additions.push(add);
      } else {
        baseItems.push({ ...add, additions: [] });
      }
    }

    return baseItems;
  }
}
