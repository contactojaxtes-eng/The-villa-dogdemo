import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Optional } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { lockOperation, operationTransaction } from '../common/operation-lock';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { DeliveryDriverGateway } from '../socket/delivery-driver.gateway';
import { receiptSummary, validateReceipt } from '../tables/receipt';
import { CompleteDriverDeliveryDto, ConfigureDriverAccessDto, CreateDriverDto, UpdateDriverDto } from './dto';

@Injectable()
export class DeliveryDriversService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
    @Optional() private deliveryDriverGateway?: DeliveryDriverGateway,
  ) {}

  private readonly portalUserSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    active: true,
    createdAt: true,
  } as const;

  private normalizeLogin(value?: string) {
    let login = String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._@-]/g, '');
    if (!login) throw new BadRequestException('Escribe un usuario o correo para el domiciliario.');
    if (!login.includes('@')) login = `${login}@thevilladog.local`;
    return login;
  }

  private normalizeAccessIdentity(value?: string) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/@.*$/, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private async assertAccessIdentityAvailable(
    driver: { id: string; name: string; userId?: string | null },
    email: string,
  ) {
    const requestedKeys = new Set([
      this.normalizeAccessIdentity(email),
      this.normalizeAccessIdentity(driver.name),
    ].filter(Boolean));

    const users = await this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
    });
    const duplicate = users.find(user => {
      if (user.id === driver.userId || user.email.toLowerCase().startsWith('deleted_')) return false;
      const existingKeys = [
        this.normalizeAccessIdentity(user.email),
        this.normalizeAccessIdentity(user.name),
      ].filter(Boolean);
      return existingKeys.some(key => requestedKeys.has(key));
    });

    if (duplicate) {
      const existingLogin = duplicate.email.replace(/@thevilladog\.local$/i, '');
      throw new ConflictException(
        `Ya existe un usuario con ese nombre o acceso: "${duplicate.name}" (${existingLogin}). Usa otro usuario o vincula esa cuenta si pertenece al mismo domiciliario; el perfil existente no fue modificado.`,
      );
    }
  }

  private getProofFile(files?: any[]) {
    return Array.isArray(files)
      ? files.find(file => ['proof', 'comprobante', 'file'].includes(String(file?.fieldname || '').toLowerCase())) || files[0]
      : undefined;
  }

  private getDriverPaymentMethod(value?: string): CompleteDriverDeliveryDto['method'] {
    const method = String(value || '').toUpperCase();
    if (!['CASH', 'TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA', 'MIXED'].includes(method)) {
      throw new BadRequestException('Selecciona el método de pago recibido: efectivo, transferencia o mixto.');
    }
    return method as CompleteDriverDeliveryDto['method'];
  }

  private getDriverPaymentBreakdown(
    method: CompleteDriverDeliveryDto['method'],
    total: number,
    data: Pick<CompleteDriverDeliveryDto, 'cashAmount' | 'transferAmount'>,
  ) {
    if (!Number.isFinite(total) || total < 0) {
      throw new BadRequestException('El total del pedido no es válido. Pide a caja que revise el pedido.');
    }

    if (method === 'CASH') {
      return { cashAmount: total, transferAmount: 0, hasTransferPart: false };
    }
    if (method !== 'MIXED') {
      return { cashAmount: 0, transferAmount: total, hasTransferPart: true };
    }

    const cashAmount = Number(data.cashAmount);
    const transferAmount = Number(data.transferAmount);
    if (!Number.isFinite(cashAmount) || !Number.isFinite(transferAmount) || cashAmount <= 0 || transferAmount <= 0) {
      throw new BadRequestException('En un pago mixto, los valores de efectivo y transferencia deben ser mayores a cero.');
    }
    if (Math.abs((cashAmount + transferAmount) - total) > 1) {
      throw new BadRequestException('Los valores de efectivo y transferencia deben sumar el total del pedido.');
    }

    return { cashAmount, transferAmount, hasTransferPart: true };
  }

  private portalOrderInclude() {
    return {
      zone: { select: { id: true, name: true, rate: true, km: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          notes: true,
          menuItem: { select: { id: true, name: true } },
        },
      },
      payment: {
        select: {
          id: true,
          amount: true,
          method: true,
          reference: true,
          status: true,
          cashAmount: true,
          transferAmount: true,
          confirmedAt: true,
        },
      },
      transferProofs: {
        select: receiptSummary,
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

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

  async findAll(activeOnly = false, filterType = 'CURRENT', cashClosingId?: string, selectedDate?: string, includePortalAccount = false) {
    const driverWhere: any = activeOnly ? { active: true } : {};
    const orderDateFilter = await this.buildOrderFilter(filterType, cashClosingId, selectedDate);

    const drivers = await this.prisma.deliveryDriver.findMany({
      where: driverWhere,
      include: {
        user: { select: this.portalUserSelect },
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
        (
          order.paymentMethod === 'MIXED' ||
          (order.paymentMethod === 'CASH' && order.paymentStatus !== 'CONFIRMED')
        )
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
        ...(includePortalAccount ? { portalUser: driver.user } : {}),
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

  async getAccessCandidates() {
    const linkedAccounts = await this.prisma.deliveryDriver.findMany({
      where: { userId: { not: null } },
      select: { userId: true },
    });
    const linkedIds = linkedAccounts.map(item => item.userId).filter((id): id is string => Boolean(id));

    return this.prisma.user.findMany({
      where: {
        active: true,
        // Nunca convertir una cuenta operativa existente (asignadores,
        // gestoras, caja, meseras, etc.). Solo se puede vincular una cuenta
        // que ya fue creada explícitamente como domiciliario.
        role: 'DELIVERY_DRIVER',
        ...(linkedIds.length ? { id: { notIn: linkedIds } } : {}),
      },
      select: this.portalUserSelect,
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  async getAccess(driverId: string) {
    const driver = await this.prisma.deliveryDriver.findUnique({
      where: { id: driverId },
      include: { user: { select: this.portalUserSelect } },
    });
    if (!driver) throw new NotFoundException('Domiciliario no encontrado');
    return {
      driver: { id: driver.id, name: driver.name, phone: driver.phone, active: driver.active },
      account: driver.user,
    };
  }

  async configureAccess(driverId: string, data: ConfigureDriverAccessDto) {
    const driver = await this.prisma.deliveryDriver.findUnique({
      where: { id: driverId },
      include: { user: { select: this.portalUserSelect } },
    });
    if (!driver) throw new NotFoundException('Domiciliario no encontrado');

    if (data.mode === 'CREATE') {
      if (!data.password || data.password.trim().length < 4) {
        throw new BadRequestException('La contraseña inicial debe tener al menos 4 caracteres.');
      }
      const email = this.normalizeLogin(data.login);
      await this.assertAccessIdentityAvailable(driver, email);

      const password = await bcrypt.hash(data.password.trim(), 10);
      if (driver.userId) {
        const currentAccount = await this.prisma.user.findUnique({
          where: { id: driver.userId },
          select: { id: true, role: true },
        });
        if (!currentAccount) {
          throw new NotFoundException('La cuenta vinculada a este domiciliario ya no existe.');
        }
        if (currentAccount.role !== 'DELIVERY_DRIVER') {
          throw new ForbiddenException(
            'La cuenta vinculada pertenece a otro perfil de trabajo. No se modificó su rol; vincula o crea una cuenta exclusiva para domiciliario.',
          );
        }
        await this.prisma.user.update({
          where: { id: driver.userId },
          data: {
            name: driver.name,
            email,
            password,
            phone: driver.phone,
            permissions: [],
            active: driver.active,
            mustVerifyEmail: false,
            emailVerified: true,
          },
        });
      } else {
        const account = await this.prisma.user.create({
          data: {
            name: driver.name,
            email,
            password,
            phone: driver.phone,
            role: 'DELIVERY_DRIVER',
            permissions: [],
            active: driver.active,
            mustVerifyEmail: false,
            emailVerified: true,
          },
          select: { id: true },
        });
        await this.prisma.deliveryDriver.update({ where: { id: driver.id }, data: { userId: account.id } });
      }
    } else {
      if (!data.userId) throw new BadRequestException('Selecciona el usuario que vas a vincular.');
      if (driver.userId && driver.userId !== data.userId) {
        throw new ConflictException('Este domiciliario ya tiene una cuenta. Restablece su acceso desde esta misma ficha.');
      }
      const account = await this.prisma.user.findUnique({ where: { id: data.userId } });
      if (!account?.active) throw new NotFoundException('El usuario seleccionado no está activo.');
      if (account.role !== 'DELIVERY_DRIVER') {
        throw new ForbiddenException('Solo puedes vincular una cuenta creada previamente para domiciliario. Crea una cuenta nueva para no modificar otro perfil de trabajo.');
      }
      await this.assertAccessIdentityAvailable(
        { id: driver.id, name: driver.name, userId: account.id },
        account.email,
      );
      const linkedDriver = await this.prisma.deliveryDriver.findFirst({ where: { userId: account.id } });
      if (linkedDriver && linkedDriver.id !== driver.id) {
        throw new ConflictException('Ese usuario ya está vinculado a otro domiciliario.');
      }
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: account.id },
          data: {
            name: driver.name,
            phone: driver.phone,
            permissions: [],
            active: driver.active,
          },
        }),
        this.prisma.deliveryDriver.update({ where: { id: driver.id }, data: { userId: account.id } }),
      ]);
    }

    const result = await this.getAccess(driver.id);
    this.socketGateway.server.emit('usersChanged');
    this.socketGateway.server.emit('driversChanged');
    return result;
  }

  async getMyPortal(userId: string) {
    const driver = await this.prisma.deliveryDriver.findUnique({
      where: { userId },
      include: { user: { select: this.portalUserSelect } },
    });
    if (!driver?.active) {
      throw new ForbiddenException('Tu cuenta no tiene un domiciliario activo asociado.');
    }

    const activeClosing = await this.prisma.cashClosing.findFirst({
      where: { isOpen: true, cashRegister: { purpose: 'DELIVERY', active: true } },
      select: {
        id: true,
        shiftStart: true,
        cashRegisterId: true,
        cashRegister: { select: { id: true, name: true } },
      },
      orderBy: { shiftStart: 'desc' },
    });

    const [activeOrders, history, settlements] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          deliveryDriverId: driver.id,
          orderType: 'DELIVERY',
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
        include: this.portalOrderInclude(),
        orderBy: { createdAt: 'asc' },
      }),
      activeClosing
        ? this.prisma.order.findMany({
          where: {
            deliveryDriverId: driver.id,
            orderType: 'DELIVERY',
            status: 'DELIVERED',
            cashClosingId: activeClosing.id,
          },
          include: this.portalOrderInclude(),
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
        : Promise.resolve([]),
      activeClosing
        ? this.prisma.driverSettlement.findMany({
          where: { driverId: driver.id, cashClosingId: activeClosing.id },
          include: {
            receivedBy: { select: { id: true, name: true } },
            orders: { select: { id: true, orderNumber: true, total: true, paymentMethod: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
        : Promise.resolve([]),
    ]);

    const pendingCash = history
      .filter(order => !order.driverSettlementId && (
        order.paymentMethod === 'MIXED' ||
        (order.paymentMethod === 'CASH' && order.paymentStatus !== 'CONFIRMED')
      ))
      .reduce((sum, order) => sum + Number(order.paymentMethod === 'MIXED' ? order.cashAmount || 0 : order.total || 0), 0);
    const pendingTransfers = history.filter(order =>
      order.paymentStatus === 'PENDING_REVIEW' &&
      ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA', 'MIXED'].includes(order.paymentMethod) &&
      Number(order.transferAmount || order.total || 0) > 0,
    ).length;

    return {
      driver: { id: driver.id, name: driver.name, phone: driver.phone, active: driver.active },
      currentShift: activeClosing ? {
        id: activeClosing.id,
        startedAt: activeClosing.shiftStart,
        registerName: activeClosing.cashRegister?.name || 'Caja Domicilios',
      } : null,
      activeOrders,
      history,
      settlements,
      summary: {
        activeOrders: activeOrders.length,
        deliveredThisShift: history.length,
        pendingCash,
        pendingTransfers,
      },
    };
  }

  async completeMyOrder(userId: string, orderId: string, data: CompleteDriverDeliveryDto, files?: any[]) {
    const method = this.getDriverPaymentMethod(data.method);
    const proofFile = this.getProofFile(files);
    // Una foto de recibo se conserva solamente durante el turno. Limitamos el
    // tamaño para que varios domiciliarios no saturen la base temporal.
    const receipt = proofFile ? await validateReceipt(proofFile, 8 * 1024 * 1024) : null;

    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const driver = await tx.deliveryDriver.findUnique({ where: { userId } });
      if (!driver?.active) throw new ForbiddenException('Tu cuenta no tiene un domiciliario activo asociado.');

      const order = await tx.order.findFirst({
        where: { id: orderId, deliveryDriverId: driver.id, orderType: 'DELIVERY' },
        include: { payment: true },
      });
      if (!order) throw new NotFoundException('No puedes cobrar un pedido que no te fue asignado.');
      if (order.status !== 'IN_ROUTE') {
        throw new BadRequestException('Solo puedes marcar como entregados los pedidos que están en ruta.');
      }

      const closing = await tx.cashClosing.findFirst({
        where: { isOpen: true, cashRegister: { purpose: 'DELIVERY', active: true } },
        select: { id: true, cashRegisterId: true },
        orderBy: { shiftStart: 'desc' },
      });
      if (!closing) throw new BadRequestException('La Caja Domicilios debe estar abierta antes de registrar el cobro.');
      if (order.cashClosingId && order.cashClosingId !== closing.id) {
        throw new BadRequestException('Este pedido pertenece a un turno anterior. Pide a caja que revise el turno antes de registrarlo.');
      }

      const amount = Number(order.total || 0);
      const { cashAmount, transferAmount, hasTransferPart } = this.getDriverPaymentBreakdown(method, amount, data);
      const paymentStatus = hasTransferPart ? 'PENDING_REVIEW' : 'DRIVER_CASH_PENDING';
      const reference = hasTransferPart ? (String(data.reference || '').trim().slice(0, 300) || null) : null;
      const payment = await tx.payment.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          amount,
          method,
          cashAmount,
          transferAmount,
          reference,
          status: paymentStatus,
        },
        update: {
          amount,
          method,
          cashAmount,
          transferAmount,
          reference,
          status: paymentStatus,
          confirmedAt: null,
          confirmedBy: null,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'DELIVERED',
          originalPaymentMethod: order.originalPaymentMethod || order.paymentMethod,
          paymentMethod: method,
          paymentStatus,
          paymentReference: reference,
          cashAmount,
          transferAmount,
          cashClosingId: closing.id,
          cashRegisterId: closing.cashRegisterId,
        },
      });

      let proof: any = null;
      if (hasTransferPart && receipt) {
        proof = await tx.transferProof.create({
          data: {
            paymentId: payment.id,
            orderId: order.id,
            cashClosingId: closing.id,
            submittedById: userId,
            amount: transferAmount,
            method,
            status: 'PENDING',
            filePath: null,
            fileBase64: `data:${receipt.mime};base64,${receipt.bytes.toString('base64')}`,
            mimeType: receipt.mime,
            fileSize: receipt.bytes.length,
            originalName: String(proofFile?.originalname || 'comprobante.jpg').slice(0, 200),
          },
        });
      }

      await tx.orderChangeLog.create({
        data: {
          orderId: order.id,
          userId,
          summary: `Domiciliario marcó como entregado y registró ${method}`,
          changes: {
            status: { before: order.status, after: 'DELIVERED' },
            paymentMethod: { before: order.paymentMethod, after: method },
            paymentStatus: { before: order.paymentStatus, after: paymentStatus },
            cashAmount: { before: order.cashAmount || 0, after: cashAmount },
            transferAmount: { before: order.transferAmount || 0, after: transferAmount },
            proofAttached: Boolean(hasTransferPart && receipt),
          },
        },
      });

      const updatedOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          waiter: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, phone: true } },
          zone: true,
          items: { include: { menuItem: true } },
          payment: true,
          deliveryDriver: { select: { id: true, name: true, phone: true } },
        },
      });
      return { order: updatedOrder, payment, proof, isTransfer: hasTransferPart };
    }, operationTransaction);

    this.socketGateway.emitOrderStatusChange(orderId, 'DELIVERED', result.order);
    this.socketGateway.server.emit('paymentUpdated', result.payment);
    if (result.isTransfer) {
      this.socketGateway.emitPaymentSubmitted({ ...result, source: 'DELIVERY_DRIVER' });
    }
    this.socketGateway.server.emit('driversChanged');
    await this.deliveryDriverGateway?.emitForOrder(result.order, {
      reason: 'delivery_completed',
      orderId,
    });
    return result;
  }

  async updateMyPayment(userId: string, orderId: string, data: CompleteDriverDeliveryDto) {
    const method = this.getDriverPaymentMethod(data.method);

    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const driver = await tx.deliveryDriver.findUnique({ where: { userId } });
      if (!driver?.active) throw new ForbiddenException('Tu cuenta no tiene un domiciliario activo asociado.');

      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          deliveryDriverId: driver.id,
          orderType: 'DELIVERY',
          status: 'DELIVERED',
        },
        include: { payment: true },
      });
      if (!order) throw new NotFoundException('No puedes modificar el cobro de este pedido.');
      if (order.driverSettlementId || order.paymentStatus === 'CONFIRMED') {
        throw new BadRequestException('Este cobro ya fue liquidado o validado y no se puede modificar.');
      }

      const closing = await tx.cashClosing.findFirst({
        where: { isOpen: true, cashRegister: { purpose: 'DELIVERY', active: true } },
        select: { id: true, cashRegisterId: true },
        orderBy: { shiftStart: 'desc' },
      });
      if (!closing) throw new BadRequestException('La Caja Domicilios debe estar abierta para corregir el cobro.');
      if (order.cashClosingId !== closing.id) {
        throw new BadRequestException('Solo puedes corregir cobros del turno actual.');
      }

      const amount = Number(order.total || 0);
      const { cashAmount, transferAmount, hasTransferPart } = this.getDriverPaymentBreakdown(method, amount, data);
      const paymentStatus = hasTransferPart ? 'PENDING_REVIEW' : 'DRIVER_CASH_PENDING';
      const reference = hasTransferPart
        ? (String(data.reference || '').trim().slice(0, 300) || order.paymentReference || null)
        : null;
      const payment = await tx.payment.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          amount,
          method,
          cashAmount,
          transferAmount,
          reference,
          status: paymentStatus,
        },
        update: {
          amount,
          method,
          cashAmount,
          transferAmount,
          reference,
          status: paymentStatus,
          confirmedAt: null,
          confirmedBy: null,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          originalPaymentMethod: order.originalPaymentMethod || order.paymentMethod,
          paymentMethod: method,
          paymentStatus,
          paymentReference: reference,
          cashAmount,
          transferAmount,
        },
      });

      const transferAmountChanged = Math.abs(Number(order.transferAmount || 0) - transferAmount) > 1;
      if (order.paymentMethod !== method || transferAmountChanged) {
        await tx.transferProof.updateMany({
          where: {
            orderId: order.id,
            status: { in: ['PENDING', 'REJECTED'] },
          },
          data: { status: 'SUPERSEDED', fileBase64: null, purgedAt: new Date() },
        });
      }

      await tx.orderChangeLog.create({
        data: {
          orderId: order.id,
          userId,
          summary: `Domiciliario corrigió el método de pago de ${order.paymentMethod} a ${method}`,
          changes: {
            paymentMethod: { before: order.paymentMethod, after: method },
            paymentStatus: { before: order.paymentStatus, after: paymentStatus },
            cashAmount: { before: order.cashAmount || 0, after: cashAmount },
            transferAmount: { before: order.transferAmount || 0, after: transferAmount },
            originalPaymentMethod: order.originalPaymentMethod || order.paymentMethod,
          },
        },
      });

      const updatedOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: this.portalOrderInclude(),
      });
      return { order: updatedOrder, payment };
    }, operationTransaction);

    this.socketGateway.server.emit('paymentUpdated', result.payment);
    this.socketGateway.server.emit('orderUpdated', result.order);
    this.socketGateway.server.emit('driversChanged');
    await this.deliveryDriverGateway?.emitForOrder(result.order, {
      reason: 'payment_changed',
      orderId,
    });
    return result;
  }

  async uploadMyProof(userId: string, orderId: string, data: CompleteDriverDeliveryDto, files?: any[]) {
    const method = this.getDriverPaymentMethod(data.method);
    if (method === 'CASH') throw new BadRequestException('El comprobante solo aplica a pagos por transferencia.');
    const proofFile = this.getProofFile(files);
    const receipt = await validateReceipt(proofFile, 8 * 1024 * 1024);

    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const driver = await tx.deliveryDriver.findUnique({ where: { userId } });
      if (!driver?.active) throw new ForbiddenException('Tu cuenta no tiene un domiciliario activo asociado.');
      const order = await tx.order.findFirst({
        where: { id: orderId, deliveryDriverId: driver.id, orderType: 'DELIVERY', status: 'DELIVERED' },
        include: { payment: true },
      });
      if (!order) throw new NotFoundException('No puedes adjuntar comprobantes a este pedido.');
      const canReplaceMixedProofAfterCashSettlement = Boolean(
        order.driverSettlementId &&
        order.paymentMethod === 'MIXED' &&
        method === 'MIXED' &&
        order.paymentStatus !== 'CONFIRMED',
      );
      if ((order.driverSettlementId && !canReplaceMixedProofAfterCashSettlement) || order.paymentStatus === 'CONFIRMED') {
        throw new BadRequestException('Este cobro ya fue liquidado o validado y no se puede modificar.');
      }

      const closing = await tx.cashClosing.findFirst({
        where: { isOpen: true, cashRegister: { purpose: 'DELIVERY', active: true } },
        select: { id: true, cashRegisterId: true },
        orderBy: { shiftStart: 'desc' },
      });
      if (!closing) throw new BadRequestException('La Caja Domicilios debe estar abierta para adjuntar el comprobante.');
      if (order.cashClosingId !== closing.id) {
        throw new BadRequestException('Solo puedes adjuntar comprobantes de pedidos del turno actual.');
      }

      const amount = Number(order.total || 0);
      if (canReplaceMixedProofAfterCashSettlement) {
        const settledCash = Number(order.cashAmount || 0);
        const settledTransfer = Number(order.transferAmount || 0);
        const requestedCash = data.cashAmount === undefined ? settledCash : Number(data.cashAmount);
        const requestedTransfer = data.transferAmount === undefined ? settledTransfer : Number(data.transferAmount);
        if (Math.abs(requestedCash - settledCash) > 1 || Math.abs(requestedTransfer - settledTransfer) > 1) {
          throw new BadRequestException('El efectivo ya fue liquidado. Puedes reemplazar el comprobante, pero no cambiar los valores del pago mixto.');
        }
      }
      const breakdownData = method === 'MIXED'
        ? {
            cashAmount: canReplaceMixedProofAfterCashSettlement
              ? order.cashAmount ?? undefined
              : data.cashAmount ?? order.cashAmount ?? undefined,
            transferAmount: canReplaceMixedProofAfterCashSettlement
              ? order.transferAmount ?? undefined
              : data.transferAmount ?? order.transferAmount ?? undefined,
          }
        : data;
      const { cashAmount, transferAmount } = this.getDriverPaymentBreakdown(method, amount, breakdownData);
      const reference = String(data.reference || '').trim().slice(0, 300) || order.paymentReference || null;
      const payment = await tx.payment.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          amount,
          method,
          cashAmount,
          transferAmount,
          reference,
          status: 'PENDING_REVIEW',
        },
        update: {
          amount,
          method,
          cashAmount,
          transferAmount,
          reference,
          status: 'PENDING_REVIEW',
          confirmedAt: null,
          confirmedBy: null,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          originalPaymentMethod: order.originalPaymentMethod || order.paymentMethod,
          paymentMethod: method,
          paymentStatus: 'PENDING_REVIEW',
          paymentReference: reference,
          cashAmount,
          transferAmount,
          cashClosingId: closing.id,
          cashRegisterId: closing.cashRegisterId,
        },
      });
      // Si el domiciliario sube una foto corregida, Caja revisa únicamente la
      // última. Conservamos el registro anterior para auditoría y liberamos
      // sus bytes inmediatamente, sin acumular imágenes en la base temporal.
      await tx.transferProof.updateMany({
        where: {
          paymentId: payment.id,
          status: { in: ['PENDING', 'REJECTED'] },
        },
        data: { status: 'SUPERSEDED', fileBase64: null, purgedAt: new Date() },
      });
      const proof = await tx.transferProof.create({
        data: {
          paymentId: payment.id,
          orderId: order.id,
          cashClosingId: closing.id,
          submittedById: userId,
          amount: transferAmount,
          method,
          status: 'PENDING',
          filePath: null,
          fileBase64: `data:${receipt.mime};base64,${receipt.bytes.toString('base64')}`,
          mimeType: receipt.mime,
          fileSize: receipt.bytes.length,
          originalName: String(proofFile?.originalname || 'comprobante.jpg').slice(0, 200),
        },
      });
      await tx.orderChangeLog.create({
        data: {
          orderId: order.id,
          userId,
          summary: 'Domiciliario adjuntó comprobante de transferencia',
          changes: {
            paymentMethod: { before: order.paymentMethod, after: method },
            paymentStatus: { before: order.paymentStatus, after: 'PENDING_REVIEW' },
            cashAmount: { before: order.cashAmount || 0, after: cashAmount },
            transferAmount: { before: order.transferAmount || 0, after: transferAmount },
          },
        },
      });
      const updatedOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          waiter: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, phone: true } },
          zone: true,
          items: { include: { menuItem: true } },
          payment: true,
          deliveryDriver: { select: { id: true, name: true, phone: true } },
        },
      });
      return { order: updatedOrder, payment, proof, isTransfer: true };
    }, operationTransaction);

    this.socketGateway.server.emit('paymentUpdated', result.payment);
    this.socketGateway.emitPaymentSubmitted({ ...result, source: 'DELIVERY_DRIVER' });
    this.socketGateway.server.emit('driversChanged');
    await this.deliveryDriverGateway?.emitForOrder(result.order, {
      reason: 'proof_changed',
      orderId,
    });
    return result;
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
        driverSettlementId: null,
        OR: [
          { paymentMethod: 'MIXED' },
          { paymentMethod: 'CASH', paymentStatus: { not: 'CONFIRMED' } },
        ],
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
          driverSettlementId: null,
          OR: [
            { paymentMethod: 'MIXED' },
            { paymentMethod: 'CASH', paymentStatus: { not: 'CONFIRMED' } },
          ],
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
        data: { driverSettlementId: settlement.id },
      });
      if (linked.count !== orderIds.length) {
        throw new BadRequestException('La liquidación cambió mientras se procesaba. Intenta nuevamente.');
      }
      // En MIXED la validacion de la transferencia y la entrega del efectivo
      // son obligaciones independientes. Liquidar el efectivo solo enlaza el
      // DriverSettlement; conserva PENDING_REVIEW/REJECTED/CONFIRMED de la
      // transferencia. Un pago CASH puro si queda confirmado aqui.
      const cashOnlyOrderIds = orders
        .filter(order => order.paymentMethod === 'CASH')
        .map(order => order.id);
      if (cashOnlyOrderIds.length) {
        await tx.order.updateMany({
          where: { id: { in: cashOnlyOrderIds }, driverSettlementId: settlement.id },
          data: { paymentStatus: 'CONFIRMED' },
        });
        await tx.payment.updateMany({
          where: { orderId: { in: cashOnlyOrderIds } },
          data: {
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            confirmedBy: receivedById,
          },
        });
      }
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
    await this.deliveryDriverGateway?.emitForDriver(driverId, {
      reason: 'settlement_changed',
    });
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
    if (driver.userId) {
      await this.prisma.user.update({
        where: { id: driver.userId },
        data: {
          ...(payload.name ? { name: payload.name } : {}),
          ...(payload.phone ? { phone: payload.phone } : {}),
          ...(typeof payload.active === 'boolean' ? { active: payload.active } : {}),
        },
      });
      this.socketGateway.server.emit('usersChanged');
    }
    this.socketGateway.server.emit('driversChanged');
    return updated;
  }

  async remove(id: string) {
    const driver = await this.prisma.deliveryDriver.findUnique({ where: { id } });
    if (!driver) throw new NotFoundException('Domiciliario no encontrado');
    const activeOrder = await this.prisma.order.findFirst({
      where: {
        deliveryDriverId: id,
        orderType: 'DELIVERY',
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
      select: { orderNumber: true },
    });
    if (activeOrder) {
      throw new BadRequestException(`Reasigna primero el pedido #${activeOrder.orderNumber} antes de desactivar al domiciliario.`);
    }

    // El historial y las liquidaciones son contables: desactivamos en lugar de
    // borrar para no perder la trazabilidad ni romper relaciones existentes.
    const deactivated = await this.prisma.$transaction(async tx => {
      const updated = await tx.deliveryDriver.update({ where: { id }, data: { active: false } });
      if (driver.userId) {
        await tx.user.update({ where: { id: driver.userId }, data: { active: false } });
      }
      return updated;
    });
    if (driver.userId) this.socketGateway.server.emit('usersChanged');
    this.socketGateway.server.emit('driversChanged');
    return deactivated;
  }
}
