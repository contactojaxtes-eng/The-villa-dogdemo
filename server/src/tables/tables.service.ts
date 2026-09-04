import { receiptSummary, validateReceipt } from './receipt';
import { Prisma } from '@prisma/client';
import { lockOperation, operationTransaction } from '../common/operation-lock';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { OrdersService } from '../orders/orders.service';

const ACTIVE_KITCHEN = ['NEW', 'PREPARING'];
const ACTIVE_TABLE = ['OPEN'];
const PENDING_PAYMENT = ['PENDING', 'PENDING_REVIEW'];

@Injectable()
export class TablesService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
    private ordersService: OrdersService,
  ) {}

  private async getActiveClosing(userId: string, cashRegisterId?: string, db: Prisma.TransactionClient = this.prisma) {
    if (cashRegisterId) {
      const specific = await db.cashClosing.findFirst({
        where: { cashRegisterId, isOpen: true },
        orderBy: { shiftStart: 'desc' },
      });
      if (specific) return specific;
    }
    const own = await db.cashClosing.findFirst({
      where: { userId, isOpen: true },
      orderBy: { shiftStart: 'desc' },
    });
    if (own) return own;

    return db.cashClosing.findFirst({ where: { isOpen: true }, orderBy: { shiftStart: 'desc' } });
  }

  private buildOrderInclude() {
    return {
      waiter: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      payment: true,
      items: { include: { menuItem: { include: { category: true } } } },
      kitchenTickets: { include: { station: true, assignedTo: { select: { id: true, name: true } }, items: true } },
      changeLogs: { orderBy: { createdAt: 'desc' as const } },
    };
  }

  private buildTableInclude() {
    return {
      openedBy: { select: { id: true, name: true } },
      cashRegister: { select: { id: true, name: true } },
      orders: {
        include: this.buildOrderInclude(),
        orderBy: { createdAt: 'asc' as const },
      },
      transferProofs: {
        select: {
          ...receiptSummary,
          submittedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
          payment: true,
        },
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

  private summarizeTable(table: any) {
    const orders = table.orders || [];
    const activeOrders = orders.filter((o: any) => o.status !== 'CANCELLED');
    const total = activeOrders.reduce((sum: number, order: any) => sum + Number(order.total || 0), 0);
    const paid = activeOrders
      .filter((o: any) => o.paymentStatus === 'CONFIRMED')
      .reduce((sum: number, order: any) => sum + Number(order.total || 0), 0);
    const tickets = activeOrders.flatMap((o: any) => o.kitchenTickets || []);
    const kitchenStatus = tickets.length === 0
      ? 'NOT_SENT'
      : tickets.some((t: any) => ACTIVE_KITCHEN.includes(t.status))
        ? 'ACTIVE'
        : tickets.every((t: any) => t.status === 'READY' || t.status === 'SERVED')
          ? 'READY'
          : 'MIXED';
    const paymentStatus = paid >= total && total > 0
      ? 'CONFIRMED'
      : activeOrders.some((o: any) => PENDING_PAYMENT.includes(o.paymentStatus))
        ? 'PENDING'
        : 'OPEN';

    return { ...table, total, paid, balance: Math.max(total - paid, 0), kitchenStatus, paymentStatus };
  }

  async listTables(params: { status?: string; search?: string; waiterId?: string }) {
    const where: any = { orders: { some: {} } };
    if (params.status === 'ALL') {
      // no status filter, return both active and closed
    } else if (params.status) {
      where.status = params.status;
    } else {
      where.status = { in: ACTIVE_TABLE };
    }
    if (params.waiterId) {
      where.OR = [
        { openedById: params.waiterId },
        { orders: { some: { waiterId: params.waiterId } } },
      ];
    }
    if (params.search?.trim()) where.label = { contains: params.search.trim(), mode: 'insensitive' };
    const tables = await this.prisma.diningTable.findMany({
      where,
      include: this.buildTableInclude(),
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
    return tables.map(t => this.summarizeTable(t));
  }

  async findTable(id: string, db: Prisma.TransactionClient = this.prisma) {
    const table = await db.diningTable.findUnique({ where: { id }, include: this.buildTableInclude() });
    if (!table) throw new NotFoundException('Mesa no encontrada');
    return this.summarizeTable(table);
  }

  async createTable(data: { label: string; notes?: string; cashRegisterId?: string }, user: any) {
    if (!data.label?.trim()) throw new BadRequestException('El nombre de la mesa es obligatorio');
    const closing = await this.getActiveClosing(user.id, data.cashRegisterId);
    const defaultRegister = await this.prisma.cashRegister.findFirst({ where: { active: true } });
    const effectiveRegisterId = closing?.cashRegisterId || data.cashRegisterId || defaultRegister?.id || null;
    const table = await this.prisma.diningTable.create({
      data: {
        label: data.label.trim(),
        notes: data.notes,
        openedById: user.id,
        cashRegisterId: effectiveRegisterId,
        cashClosingId: closing?.id || null,
      },
      include: this.buildTableInclude(),
    });
    this.socketGateway.emitTableCreated(this.summarizeTable(table));
    return this.summarizeTable(table);
  }

  async createTableOrder(data: any, user: any) {
    const clientMutationId = data.clientMutationId || randomUUID();
    const tickets: any[] = [];
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const existing = await tx.order.findUnique({ where: { clientMutationId }, include: this.buildOrderInclude() });
      if (existing) {
        if (existing.waiterId !== user.id || !existing.tableId) throw new BadRequestException('El identificador del pedido ya está en uso');
        return { table: await this.findTable(existing.tableId, tx), order: existing, replay: true };
      }
      let label = typeof data.tableLabel === 'string' ? data.tableLabel.trim() : '';
      if (!data.tableId && !label) {
        const count = await tx.diningTable.count({ where: { status: 'OPEN' } });
        label = `Mesa ${count + 1}`;
      }
      if (label.length > 80) label = label.slice(0, 80);
      let table = data.tableId ? await tx.diningTable.findUnique({ where: { id: data.tableId } }) : null;
      if (data.tableId && !table) throw new NotFoundException('Cuenta no encontrada');
      if (table && table.status !== 'OPEN') throw new BadRequestException('La cuenta ya está cerrada');
      const closing = await this.getActiveClosing(user.id, table?.cashRegisterId || data.cashRegisterId, tx);
      if (!closing) throw new BadRequestException('Abre una caja antes de enviar pedidos');
      const defaultRegister = await tx.cashRegister.findFirst({ where: { active: true } });
      const effectiveRegisterId = table?.cashRegisterId || closing.cashRegisterId || data.cashRegisterId || defaultRegister?.id || null;
      if (!table) {
        table = await tx.diningTable.create({ data: {
          label, openedById: user.id, cashRegisterId: effectiveRegisterId, cashClosingId: closing.id,
        } });
      } else if (!table.cashRegisterId && effectiveRegisterId) {
        await tx.diningTable.update({
          where: { id: table.id },
          data: { cashRegisterId: effectiveRegisterId, cashClosingId: closing.id },
        });
        table.cashRegisterId = effectiveRegisterId;
      }
      if (await tx.payment.count({ where: { order: { tableId: table.id }, status: 'PENDING_REVIEW' } })) {
        throw new BadRequestException('Espera a que caja revise el pago antes de agregar productos');
      }
      const order = await this.ordersService.createWithinTransaction({
        customerName: table.label, customerPhone: '3000000000', customerAddress: table.label,
        notes: data.notes, items: (data.items || []).map((item: any) => ({ menuItemId: item.menuItemId, quantity: item.quantity, notes: item.notes })),
        waiterId: user.id, userId: user.id, userRole: user.role, orderType: 'LOCAL',
        source: data.offline ? 'OFFLINE_TABLE' : 'TABLE', paymentMethod: 'CASH',
        cashRegisterId: table.cashRegisterId || effectiveRegisterId, tableId: table.id, clientMutationId,
      }, tx);
      await this.createKitchenTickets(order.id, user.id, false, undefined, undefined, undefined, tx, tickets);
      return { table: await this.findTable(table.id, tx), order, replay: false };
    }, operationTransaction);
    if (!result.replay) {
      tickets.forEach(event => event.created ? this.socketGateway.emitKitchenTicketCreated(event.ticket) : this.socketGateway.emitKitchenTicketUpdated(event.ticket));
      this.socketGateway.server.emit('tableOrderSubmitted', result);
      this.socketGateway.emitTableUpdated(result.table);
      await this.ordersService.notifyCreated(result.order);
    }
    this.socketGateway.server.to(`user:${user.id}`).emit('offlineOrderSynced', result.order);
    return { table: result.table, order: result.order };
  }

  private async buildChangeSummary(before: any[], after: any[], db: Prisma.TransactionClient = this.prisma) {
    const key = (item: any) => `${item.menuItemId}_${(item.notes || '').trim().toLowerCase()}`;
    const beforeMap = new Map(before.map(item => [key(item), item]));
    const afterMap = new Map(after.map(item => [key(item), item]));
    const changeMap = new Map<string, any>();
    const parts: string[] = [];

    // Resolver nombres reales de productos para items nuevos
    const missingIds = after.filter(a => !before.some(b => b.menuItemId === a.menuItemId)).map(a => a.menuItemId);
    const resolvedNewItems = missingIds.length > 0 ? await db.menuItem.findMany({ where: { id: { in: missingIds } } }) : [];
    const newItemsNameMap = new Map(resolvedNewItems.map(m => [m.id, m.name]));

    const getName = (item: any) => {
      return item.name || item.menuItem?.name || newItemsNameMap.get(item.menuItemId) || before.find(b => b.menuItemId === item.menuItemId)?.menuItem?.name || 'Producto';
    };

    for (const item of after) {
      const itemK = key(item);
      const prev = beforeMap.get(itemK);
      const prodName = getName(item);
      const countInAfter = after.filter(a => a.menuItemId === item.menuItemId).length;
      const countInBefore = before.filter(b => b.menuItemId === item.menuItemId).length;
      const canUseMenuItemKey = countInAfter <= 1 && countInBefore <= 1;

      if (!prev) {
        parts.push(`✨ Agregado: +${item.quantity}x ${prodName}${item.notes ? ` (${item.notes})` : ''}`);
        const addInfo = { changeType: 'ADDED', quantity: item.quantity, previousQty: 0, previousNotes: null };
        changeMap.set(itemK, addInfo);
        if (canUseMenuItemKey && !changeMap.has(item.menuItemId)) changeMap.set(item.menuItemId, addInfo);
      } else {
        const qtyDiff = Number(item.quantity) - Number(prev.quantity);
        const notesChanged = String(prev.notes || '').trim().toLowerCase() !== String(item.notes || '').trim().toLowerCase();

        if (qtyDiff !== 0 || notesChanged) {
          if (qtyDiff !== 0) {
            const qtyText = qtyDiff > 0 ? `+${qtyDiff} un. (${prev.quantity} -> ${item.quantity})` : `-${Math.abs(qtyDiff)} un. (${prev.quantity} -> ${item.quantity})`;
            parts.push(`✏️ Modificado: ${prodName} [${qtyText}]${item.notes ? ` (${item.notes})` : ''}`);
          } else {
            parts.push(`✏️ Cambio de nota: ${prodName} (${item.notes || 'sin nota'})`);
          }
          const modInfo = { changeType: 'MODIFIED', previousQty: prev.quantity, previousNotes: prev.notes, quantity: item.quantity };
          changeMap.set(itemK, modInfo);
          if (canUseMenuItemKey) changeMap.set(item.menuItemId, modInfo);
        } else {
          const unchInfo = { changeType: 'UNCHANGED', quantity: item.quantity, previousQty: prev.quantity, previousNotes: prev.notes };
          changeMap.set(itemK, unchInfo);
          if (canUseMenuItemKey && !changeMap.has(item.menuItemId)) changeMap.set(item.menuItemId, unchInfo);
        }
      }
    }

    for (const item of before) {
      const itemK = key(item);
      if (!afterMap.has(itemK)) {
        const prodName = getName(item);
        parts.push(`❌ Quitado: -${item.quantity}x ${prodName}`);
        const remInfo = { changeType: 'REMOVED', previousQty: item.quantity, previousNotes: item.notes };
        changeMap.set(itemK, remInfo);
        if (!after.some(a => a.menuItemId === item.menuItemId)) {
          changeMap.set(item.menuItemId, remInfo);
        }
      }
    }

    return { summary: parts.join(' | ') || 'Pedido editado sin cambios de productos', changeMap };
  }

  async updateTableOrder(orderId: string, data: any, user: any) {
    const tickets: any[] = [];
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const existing = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { menuItem: { include: { category: true } } } }, diningTable: true },
      });
      if (!existing?.tableId) throw new NotFoundException('Pedido de mesa no encontrado');
      if (existing.diningTable?.status !== 'OPEN') throw new BadRequestException('La cuenta está cerrada');
      const { summary, changeMap } = await this.buildChangeSummary(existing.items, data.items || [], tx);
      const updateData = {
        customerName: existing.customerName, customerPhone: existing.customerPhone,
        customerAddress: existing.customerAddress, notes: data.notes ?? existing.notes,
        items: (data.items || []).map((item: any) => ({ menuItemId: item.menuItemId, quantity: item.quantity, notes: item.notes })),
        paymentMethod: existing.paymentMethod, orderType: 'LOCAL',
      };
      const { updated } = await this.ordersService.updateWithinTransaction(orderId, updateData, tx);
      await this.createKitchenTickets(orderId, user.id, true, summary, changeMap, existing.items, tx, tickets);
      return { table: await this.findTable(existing.tableId, tx), order: updated, changeSummary: summary };
    }, operationTransaction);
    tickets.forEach(event => {
      if (event.isEdited) {
        this.socketGateway.emitKitchenTicketEdited(event.ticket);
      } else if (event.created) {
        this.socketGateway.emitKitchenTicketCreated(event.ticket);
      } else {
        this.socketGateway.emitKitchenTicketUpdated(event.ticket);
      }
    });
    this.socketGateway.server.emit('tableOrderEdited', { orderId, changeSummary: result.changeSummary });
    this.socketGateway.emitTableUpdated(result.table);
    return result;
  }

  private async getStations(db: Prisma.TransactionClient = this.prisma) {
    let stations = await db.kitchenStation.findMany({
      where: { active: true },
      include: { categories: true, users: { select: { id: true, name: true } } },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
    if (stations.length === 0) {
      const cats = await db.menuCategory.findMany({ where: { active: true }, take: 2 });
      const created = await db.kitchenStation.create({
        data: {
          name: 'Cocina general',
          priority: 999,
          categories: cats.length ? { connect: cats.map(c => ({ id: c.id })) } : undefined,
        },
        include: { categories: true, users: { select: { id: true, name: true } } },
      });
      stations = [created];
    }
    return stations;
  }

  private async pickCook(stationId: string, db: Prisma.TransactionClient = this.prisma) {
    const station = await db.kitchenStation.findUnique({
      where: { id: stationId },
      include: { users: true },
    });
    const stationUsers = (station?.users || []).filter(u => u.active);
    if (stationUsers.length === 0) return null;

    // Obtener estados de cocineros (activo/desactivado y tiempo de cena/descanso)
    const cookStatuses = await this.getCookStatuses(db);
    const now = Date.now();

    // Filtrar cocineros que estén activos Y no estén en cena activa
    const availableUsers = stationUsers.filter(u => {
      const s = cookStatuses[u.id];
      if (s) {
        if (s.active === false) return false; // Desactivado manualmente por el admin
        if (s.onBreak && s.breakUntil && now < s.breakUntil) return false; // En tiempo de cena / pausa
      }
      return true;
    });

    // Si hay cocineros disponibles (ej: 2 de 3, o 1 de 3), se divide equitativamente entre ellos.
    // Si todos estuvieran en pausa/desactivados, se recurre a stationUsers para que la comanda no quede huérfana.
    const users = availableUsers.length > 0 ? availableUsers : stationUsers;
    if (users.length === 1) return users[0].id;

    // Ventana del turno actual (últimas 14 horas para cubrir turnos noche que cruzan medianoche)
    const shiftWindow = new Date(Date.now() - 14 * 60 * 60 * 1000);

    const loads = await Promise.all(users.map(async user => {
      // 1. Historial de tickets asignados en este turno para equidad estricta 50/50
      const todayTickets = await db.kitchenTicket.findMany({
        where: {
          stationId,
          assignedToId: user.id,
          createdAt: { gte: shiftWindow },
          status: { not: 'CANCELLED' },
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      // 2. Tickets activos inmediatos (para desempate)
      const activeTickets = await db.kitchenTicket.findMany({
        where: { stationId, assignedToId: user.id, status: { in: ACTIVE_KITCHEN } },
        select: { id: true },
      });

      const totalShiftTickets = todayTickets.length;
      const lastAssignedAt = todayTickets.length > 0 ? todayTickets[0].createdAt.getTime() : 0;

      return {
        user,
        activeCount: activeTickets.length,
        totalShiftTickets,
        lastAssignedAt,
      };
    }));

    loads.sort((a, b) => {
      // 1. EQUIDAD ESTRICTA 50/50: Se asigna al cocinero que lleva MENOS pedidos asignados en el turno.
      // Si Jose lleva 2 y Juan lleva 1 -> le toca a Juan.
      if (a.totalShiftTickets !== b.totalShiftTickets) {
        return a.totalShiftTickets - b.totalShiftTickets;
      }

      // 2. ALTERNANCIA ESTRICTA ROUND-ROBIN (1 para Jose, 1 para Juan):
      // Si ambos llevan la misma cantidad de pedidos hoy, se asigna al que lleve MÁS TIEMPO sin recibir pedido (ticket más antiguo).
      if (a.lastAssignedAt !== b.lastAssignedAt) {
        return a.lastAssignedAt - b.lastAssignedAt;
      }

      // 3. Desempate por menor carga activa inmediata
      if (a.activeCount !== b.activeCount) {
        return a.activeCount - b.activeCount;
      }

      // 4. Desempate final determinista
      return a.user.id.localeCompare(b.user.id);
    });

    return loads[0].user.id;
  }

  private isDrinkCategory(categoryName: string): boolean {
    const lower = (categoryName || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return (
      lower.includes('bebida') ||
      lower.includes('gaseosa') ||
      lower.includes('jugo') ||
      lower.includes('agua') ||
      lower.includes('refresco') ||
      lower.includes('soda') ||
      lower.includes('cerveza')
    );
  }

  async getKitchenSettings(db: Prisma.TransactionClient = this.prisma) {
    const setting = await db.appSetting.findUnique({ where: { key: 'kitchen_routing_settings' } });
    if (setting) {
      try {
        return JSON.parse(setting.value);
      } catch (e) {}
    }
    return {
      smartDrinkRouting: false,
      multiStationDrinkTarget: 'none',
      splitByChannel: true,
    };
  }

  async updateKitchenSettings(data: any) {
    const updated = await this.prisma.appSetting.upsert({
      where: { key: 'kitchen_routing_settings' },
      update: { value: JSON.stringify(data) },
      create: { key: 'kitchen_routing_settings', value: JSON.stringify(data) },
    });
    return JSON.parse(updated.value);
  }

  async getCookStatuses(db: Prisma.TransactionClient = this.prisma): Promise<Record<string, {
    active: boolean;
    onBreak: boolean;
    breakMinutes?: number;
    breakStartedAt?: number;
    breakUntil?: number | null;
    breakReason?: string;
    notifiedFinished?: boolean;
  }>> {
    const setting = await db.appSetting.findUnique({ where: { key: 'kitchen_cook_status' } });
    let statuses: Record<string, any> = {};
    if (setting) {
      try {
        statuses = JSON.parse(setting.value) || {};
      } catch (e) {}
    }

    let changed = false;
    const now = Date.now();
    for (const [userId, status] of Object.entries(statuses)) {
      if (status && status.onBreak && status.breakUntil && now >= status.breakUntil) {
        if (!status.notifiedFinished) {
          this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }).then(u => {
            const userName = u?.name || 'Cocinero';
            this.socketGateway.server.emit('cookBreakFinished', {
              userId,
              userName,
              finishedAt: now,
              breakReason: status.breakReason || 'Cena',
              breakMinutes: status.breakMinutes || 15,
            });
          }).catch(() => {});
          status.notifiedFinished = true;
          changed = true;
        }
        status.onBreak = false;
        changed = true;
      }
    }

    if (changed) {
      await this.prisma.appSetting.upsert({
        where: { key: 'kitchen_cook_status' },
        update: { value: JSON.stringify(statuses) },
        create: { key: 'kitchen_cook_status', value: JSON.stringify(statuses) },
      });
      this.socketGateway.server.emit('kitchenCookStatusChanged', statuses);
    }

    return statuses;
  }

  async updateCookStatus(userId: string, data: { active?: boolean; onBreak?: boolean; breakMinutes?: number; breakReason?: string }) {
    const statuses = await this.getCookStatuses();
    const existing = statuses[userId] || { active: true, onBreak: false };

    if (data.active !== undefined) {
      existing.active = Boolean(data.active);
    }

    if (data.onBreak === true) {
      const minutes = Math.max(1, Math.min(240, Number(data.breakMinutes) || 15));
      existing.onBreak = true;
      existing.breakMinutes = minutes;
      existing.breakStartedAt = Date.now();
      existing.breakUntil = Date.now() + minutes * 60 * 1000;
      existing.breakReason = (data.breakReason || 'Cena').slice(0, 50);
      existing.notifiedFinished = false;
    } else if (data.onBreak === false) {
      existing.onBreak = false;
      existing.breakUntil = null;
      existing.notifiedFinished = true;
    }

    statuses[userId] = existing;

    const updated = await this.prisma.appSetting.upsert({
      where: { key: 'kitchen_cook_status' },
      update: { value: JSON.stringify(statuses) },
      create: { key: 'kitchen_cook_status', value: JSON.stringify(statuses) },
    });

    const result = JSON.parse(updated.value);
    this.socketGateway.server.emit('kitchenCookStatusChanged', result);

    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (data.onBreak === true) {
      this.socketGateway.server.emit('cookBreakStarted', {
        userId,
        userName: u?.name || 'Cocinero',
        breakMinutes: existing.breakMinutes,
        breakUntil: existing.breakUntil,
        breakReason: existing.breakReason,
      });
    } else if (data.onBreak === false) {
      this.socketGateway.server.emit('cookBreakReincorporated', {
        userId,
        userName: u?.name || 'Cocinero',
      });
    }

    return result;
  }

  async deleteStation(id: string) {
    await this.prisma.kitchenStation.delete({ where: { id } });
    this.socketGateway.server.emit('kitchenStationsChanged', { id, deleted: true });
    return { success: true };
  }

  async createKitchenTickets(orderId: string, actorId: string, isEdited = false, changeSummary?: string, changeMap?: Map<string, any>, removedCandidateItems?: any[], db: Prisma.TransactionClient = this.prisma, events?: any[]) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: { include: { category: true } } } }, diningTable: true, waiter: true },
    });
    if (!order) throw new NotFoundException('Pedido de mesa no encontrado');

    const isSalon = !!(order.tableId || order.orderType === 'DINE_IN');
    const allActiveStations = await this.getStations(db);
    const settings = await this.getKitchenSettings(db);

    // 1. Filtrar estaciones según canal (Salón vs Domicilios) si existen diferenciadas
    let eligibleStations = allActiveStations;
    if (settings.splitByChannel !== false) {
      const channelPattern = isSalon ? /sal[oó]n/i : /domicilio/i;
      const channelStations = allActiveStations.filter(s => channelPattern.test(s.name));
      if (channelStations.length > 0) {
        eligibleStations = allActiveStations.filter(
          s => channelPattern.test(s.name) || (!/sal[oó]n/i.test(s.name) && !/domicilio/i.test(s.name))
        );
      }
    }

    const generalStation = eligibleStations.find(s => /general/i.test(s.name))
      || eligibleStations.find(s => s.categories.length === 0)
      || eligibleStations[eligibleStations.length - 1];

    // 2. Filtrar Comida para Cocina: LAS BEBIDAS NO SALEN A NINGUNA COCINA.
    // En The Villa Dog las meseras despachan las bebidas directamente de la nevera/barra.
    const foodItems = order.items.filter(item => {
      const catName = item.menuItem?.category?.name || '';
      return !this.isDrinkCategory(catName);
    });

    // 3. Agrupar comida en sus estaciones respectivas
    const stationGroups = new Map<string, any[]>();
    for (const item of foodItems) {
      const categoryId = item.menuItem?.categoryId;
      const targetStation = eligibleStations.find(s => s.categories?.some(c => c.id === categoryId)) || generalStation;
      if (!targetStation) continue;
      if (!stationGroups.has(targetStation.id)) stationGroups.set(targetStation.id, []);
      stationGroups.get(targetStation.id)!.push(item);
    }

    // 4. Al editar: incorporar items cancelados/eliminados de comida a su estación correspondiente
    if (isEdited && removedCandidateItems && changeMap) {
      for (const oldItem of removedCandidateItems) {
        if (changeMap.get(oldItem.menuItemId)?.changeType === 'REMOVED') {
          const catName = oldItem.menuItem?.category?.name || '';
          // Si era una bebida eliminada, NO enviar a cocina (las bebidas nunca van a cocina)
          if (this.isDrinkCategory(catName)) continue;
          const fallbackStation = generalStation || eligibleStations[0] || allActiveStations[0];
          const targetStation = eligibleStations.find(s => s.categories?.some(c => c.id === oldItem.menuItem?.categoryId)) || fallbackStation;
          if (targetStation?.id) {
            if (!stationGroups.has(targetStation.id)) stationGroups.set(targetStation.id, []);
            stationGroups.get(targetStation.id)!.push({
              ...oldItem,
              isRemovedItem: true,
            });
          }
        }
      }
    }

    const tickets: any[] = [];
    for (const [stationId, items] of stationGroups.entries()) {
      // Buscar si YA EXISTE un ticket ACTIVO en preparación para este pedido y estación.
      // REGLA CRÍTICA: NUNCA tocar ni sobreescribir tickets completados (READY o SERVED),
      // esos pertenecen al HISTORIAL del cocinero y deben permanecer intactos.
      let existingTicket: any = null;
      if (isEdited) {
        existingTicket = await db.kitchenTicket.findFirst({
          where: {
            orderId,
            stationId,
            status: { in: ['NEW', 'PREPARING'] },
          },
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        });
      }

      // Si el pedido fue editado y no hay ticket abierto (porque el anterior ya fue despachado/listo):
      // Creamos un ticket de ADICIÓN exclusivamente con los productos nuevos o incrementos.
      let ticketItemsData: any[] = [];
      let isAdditionTicket = false;

      if (isEdited && !existingTicket) {
        isAdditionTicket = true;
        // Filtrar exclusivamente los productos agregados nuevos o con incremento de cantidad (adición)
        const additionCandidates = items.filter(item => {
          const itemK = `${item.menuItemId}_${(item.notes || '').trim().toLowerCase()}`;
          const itemKRaw = `${item.menuItemId}_${(item.notes || '').trim()}`;
          const changeInfo = changeMap?.get(itemK) || changeMap?.get(itemKRaw) || changeMap?.get(item.menuItemId);
          if (!changeInfo) return false;
          if (changeInfo.changeType === 'ADDED') return true;
          if (changeInfo.changeType === 'MODIFIED') {
            const diff = Number(item.quantity) - Number(changeInfo.previousQty ?? 0);
            return diff > 0 || (item.notes && item.notes !== changeInfo.previousNotes);
          }
          return false;
        });

        if (additionCandidates.length === 0) {
          // No hubo adiciones a preparar para esta estación; el ticket completado previo queda intacto.
          continue;
        }

        ticketItemsData = additionCandidates.map(item => {
          const itemK = `${item.menuItemId}_${(item.notes || '').trim().toLowerCase()}`;
          const itemKRaw = `${item.menuItemId}_${(item.notes || '').trim()}`;
          const changeInfo = changeMap?.get(itemK) || changeMap?.get(itemKRaw) || changeMap?.get(item.menuItemId);
          const prevQty = Number(changeInfo?.previousQty ?? 0);
          const addQty = changeInfo?.changeType === 'ADDED' ? item.quantity : Math.max(1, item.quantity - prevQty);

          const totalNote = prevQty > 0 ? `[Adición +${addQty} un. · Total mesa: ${item.quantity}]` : '';
          const finalNote = [item.notes || '', totalNote].filter(Boolean).join(' ').trim() || null;

          return {
            orderItemId: item.id || null,
            menuItemId: item.menuItemId,
            quantity: addQty,
            nameSnapshot: item.menuItem?.name || item.nameSnapshot || 'Producto',
            notes: finalNote,
            changeType: 'ADDED',
            previousQty: prevQty > 0 ? prevQty : null,
            previousNotes: changeInfo?.previousNotes ?? null,
          };
        });
      } else {
        // Ticket inicial o actualización de ticket activo en preparación
        ticketItemsData = items.map(item => {
          const itemK = `${item.menuItemId}_${(item.notes || '').trim().toLowerCase()}`;
          const itemKRaw = `${item.menuItemId}_${(item.notes || '').trim()}`;
          const changeInfo = changeMap?.get(itemK) || changeMap?.get(itemKRaw) || changeMap?.get(item.menuItemId);
          let changeType = 'UNCHANGED';
          if (item.isRemovedItem || changeInfo?.changeType === 'REMOVED') {
            changeType = 'REMOVED';
          } else if (changeInfo?.changeType === 'ADDED') {
            changeType = 'ADDED';
          } else if (changeInfo?.changeType === 'MODIFIED') {
            changeType = 'MODIFIED';
          } else if (isEdited) {
            changeType = 'UNCHANGED';
          }

          return {
            orderItemId: item.isRemovedItem ? null : (item.id || null),
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            nameSnapshot: item.menuItem?.name || item.nameSnapshot || 'Producto',
            notes: item.notes || null,
            changeType,
            previousQty: changeInfo?.previousQty ?? null,
            previousNotes: changeInfo?.previousNotes ?? null,
          };
        });
      }

      const hasActiveItems = ticketItemsData.some(i => i.changeType !== 'REMOVED');
      const stationHasChanges = ticketItemsData.some(i => i.changeType !== 'UNCHANGED');

      // Si el pedido fue editado pero esta estación no tuvo cambios ni adiciones, no molestar a cocina
      if (isEdited && !stationHasChanges && !isAdditionTicket) {
        continue;
      }

      const stationIsEdited = isEdited && (stationHasChanges || isAdditionTicket);

      // Generar el resumen de cambios EXCLUSIVO para esta estación
      const stationSummaryParts: string[] = [];
      for (const i of ticketItemsData) {
        if (i.changeType === 'ADDED') {
          stationSummaryParts.push(`✨ Agregado: +${i.quantity}x ${i.nameSnapshot}${i.notes ? ` (${i.notes})` : ''}`);
        } else if (i.changeType === 'REMOVED') {
          stationSummaryParts.push(`❌ Quitado: -${i.quantity}x ${i.nameSnapshot}`);
        } else if (i.changeType === 'MODIFIED') {
          const diff = i.previousQty !== null && i.previousQty !== undefined ? (i.quantity - i.previousQty) : 0;
          const diffTxt = diff > 0 ? `+${diff} un.` : `-${Math.abs(diff)} un.`;
          stationSummaryParts.push(`✏️ Modificado: ${i.nameSnapshot} [${diffTxt}]${i.notes ? ` (${i.notes})` : ''}`);
        }
      }
      const stationChangeSummary = stationIsEdited ? (stationSummaryParts.join(' | ') || (isAdditionTicket ? '✨ Nueva adición al pedido' : null)) : null;

      if (existingTicket) {
        // ACTUALIZAR LA TARJETA ACTIVA EXISTENTE (no crear duplicados de tarjetas en preparación)
        await db.kitchenTicketItem.deleteMany({ where: { ticketId: existingTicket.id } });

        let newStatus = existingTicket.status;
        if (!hasActiveItems) {
          newStatus = 'CANCELLED';
        } else if (stationIsEdited) {
          // Si hubo cambios mientras estaba en cocina, alertar al cocinero en paso inicial
          newStatus = 'NEW';
        }

        const assignedToId = existingTicket.assignedToId || await this.pickCook(stationId, db);

        const updatedTicket = await db.kitchenTicket.update({
          where: { id: existingTicket.id },
          data: {
            ...(assignedToId ? { assignedToId } : {}),
            isEdited: stationIsEdited,
            changeSummary: stationChangeSummary,
            status: newStatus,
            items: {
              create: ticketItemsData,
            },
          },
          include: { station: { include: { users: { select: { id: true, name: true, role: true } } } }, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
        });
        tickets.push(updatedTicket);
        if (events) {
          events.push({ created: false, ticket: updatedTicket, isEdited: stationIsEdited });
        } else if (stationIsEdited) {
          this.socketGateway.emitKitchenTicketEdited(updatedTicket);
        } else {
          this.socketGateway.emitKitchenTicketUpdated(updatedTicket);
        }
      } else {
        // CREAR TICKET NUEVO (primera vez o adición cuando el ticket previo ya fue despachado)
        const assignedToId = await this.pickCook(stationId, db);
        const newStatus = hasActiveItems ? 'NEW' : 'CANCELLED';
        const newTicket = await db.kitchenTicket.create({
          data: {
            orderId,
            tableId: order.tableId,
            stationId,
            assignedToId,
            isEdited: stationIsEdited,
            changeSummary: stationChangeSummary,
            status: newStatus,
            items: {
              create: ticketItemsData,
            },
          },
          include: { station: { include: { users: { select: { id: true, name: true, role: true } } } }, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
        });
        tickets.push(newTicket);
        if (events) {
          events.push({ created: true, ticket: newTicket, isEdited: stationIsEdited });
        } else if (stationIsEdited) {
          this.socketGateway.emitKitchenTicketEdited(newTicket);
        } else {
          this.socketGateway.emitKitchenTicketCreated(newTicket);
        }
      }
    }

    await db.order.update({
      where: { id: orderId },
      data: { kitchenStatus: 'SENT', sentToKitchenAt: order.sentToKitchenAt || new Date() },
    });

    if (isEdited) {
      await db.orderChangeLog.create({
        data: {
          orderId,
          userId: actorId,
          summary: changeSummary || 'Pedido editado',
          changes: { summary: changeSummary || 'Pedido editado' },
        },
      });
      if (!events) this.socketGateway.server.emit('tableOrderEdited', { orderId, changeSummary });
    }
    return tickets;
  }

  async updateKitchenTicket(ticketId: string, status: string, user: any) {
    if (!['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'].includes(status)) throw new BadRequestException('Estado de cocina inválido');
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const ticket = await tx.kitchenTicket.findUnique({ where: { id: ticketId }, include: { order: { include: { waiter: true, diningTable: true } } } });
      if (!ticket) throw new NotFoundException('Ticket no encontrado');
      if (ticket.tableId) {
        const table = await tx.diningTable.findUnique({ where: { id: ticket.tableId } });
        if (table?.status === 'CLOSED' && ticket.status !== status) throw new BadRequestException('La cuenta ya está cerrada');
      }
      if (ticket.status === status) {
        return { updated: ticket, table: null };
      }
      const transitions: Record<string, string[]> = {
        NEW: ['PREPARING', 'READY', 'SERVED', 'CANCELLED'],
        PREPARING: ['READY', 'SERVED', 'NEW', 'CANCELLED'],
        READY: ['SERVED', 'PREPARING', 'NEW', 'CANCELLED'],
        SERVED: ['READY', 'PREPARING', 'CANCELLED'],
        CANCELLED: ['SERVED', 'NEW', 'PREPARING', 'CANCELLED'],
      };
      if (!transitions[ticket.status]?.includes(status)) throw new BadRequestException('El pedido cambió. Actualiza cocina antes de continuar.');
      const updated = await tx.kitchenTicket.update({ where: { id: ticketId }, data: {
        status, assignedToId: ticket.assignedToId || user.id,
        ...(status === 'PREPARING' ? { startedAt: ticket.startedAt || new Date() } : {}),
        ...(status === 'READY' ? { readyAt: ticket.readyAt || new Date() } : {}),
        ...(status === 'SERVED' ? { servedAt: ticket.servedAt || new Date() } : {}),
      }, include: { station: { include: { users: { select: { id: true, name: true, role: true } } } }, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } } });
      const active = await tx.kitchenTicket.count({ where: { orderId: ticket.orderId, status: { in: ACTIVE_KITCHEN } } });
      await tx.order.update({ where: { id: ticket.orderId }, data: { kitchenStatus: active ? 'ACTIVE' : 'READY' } });
      return { updated, table: ticket.tableId ? await this.finishPaidTable(ticket.tableId, tx) : null };
    }, operationTransaction);
    this.socketGateway.emitKitchenTicketUpdated(result.updated);
    if (status === 'READY') {
      const waiterId = (result.updated.order as any)?.waiterId || (result.updated.order as any)?.diningTable?.openedById || result.table?.openedById;
      this.socketGateway.emitKitchenTicketReady(waiterId, result.updated);
      this.socketGateway.emitOrderStatusChange(result.updated.orderId, 'READY', result.updated.order);
    }
    if (result.table) this.emitAccount(result.table);
    return result.updated;
  }

  async listKitchenTickets(user: any, params: { status?: string; stationId?: string }) {
    const where: any = {};
    if (params.status && params.status !== 'ALL') {
      where.status = params.status;
    } else if (params.status === 'ALL') {
      // No filtrar por estado
    } else {
      where.status = { in: ['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'] };
    }
    if (params.stationId) where.stationId = params.stationId;
    if (!['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user.role)) {
      where.OR = [
        { assignedToId: user.id },
        { assignedToId: null, station: { users: { some: { id: user.id } } } },
      ];
    }
    const tickets = await this.prisma.kitchenTicket.findMany({
      where,
      include: { station: { include: { users: { select: { id: true, name: true, role: true } } } }, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 250,
    });

    return tickets;
  }

  async listStations() {
    return this.prisma.kitchenStation.findMany({
      include: { categories: true, users: { select: { id: true, name: true, role: true } } },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
  }

  async saveStation(data: any) {
    const payload: any = {
      name: data.name?.trim(),
      active: data.active !== false,
      priority: Number(data.priority || 0),
      color: data.color || '#F97316',
      categories: { set: (data.categoryIds || []).map((id: string) => ({ id })) },
      users: { set: (data.userIds || []).map((id: string) => ({ id })) },
    };
    if (!payload.name) throw new BadRequestException('El nombre de la estacion es obligatorio');
    const station = data.id
      ? await this.prisma.kitchenStation.update({ where: { id: data.id }, data: payload, include: { categories: true, users: true } })
      : await this.prisma.kitchenStation.create({ data: payload, include: { categories: true, users: true } });
    this.socketGateway.server.emit('kitchenStationsChanged', station);
    return station;
  }

  private async finishPaidTable(tableId: string, tx: Prisma.TransactionClient) {
    let table = await this.findTable(tableId, tx);
    if (table.status === 'OPEN' && table.orders.length && table.balance === 0 && table.kitchenStatus !== 'ACTIVE') {
      await tx.order.updateMany({ where: { tableId, status: { not: 'CANCELLED' }, paymentStatus: 'CONFIRMED' }, data: { status: 'DELIVERED' } });
      await tx.kitchenTicket.updateMany({ where: { tableId, status: 'READY' }, data: { status: 'SERVED', servedAt: new Date() } });
      await tx.diningTable.update({ where: { id: tableId }, data: { status: 'CLOSED', closedAt: new Date() } });
      table = await this.findTable(tableId, tx);
    }
    return table;
  }

  private emitAccount(table: any) {
    if (table.status === 'CLOSED') this.socketGateway.emitTableClosed(table);
    else this.socketGateway.emitTableUpdated(table);
  }

  async submitPayment(tableId: string, data: any, user: any, fileOrFiles?: any) {
    if (!['CASH', 'TRANSFER', 'MIXED'].includes(data.method)) throw new BadRequestException('Método de pago inválido');
    const isCash = data.method === 'CASH';
    const isMixed = data.method === 'MIXED';
    const isTransfer = data.method === 'TRANSFER';

    const rawFiles: any[] = Array.isArray(fileOrFiles) ? fileOrFiles : (fileOrFiles ? [fileOrFiles] : []);
    const filesWithProofs = rawFiles.filter(f => f && f.fieldname === 'proofs');
    const filesToUse = filesWithProofs.length > 0 ? filesWithProofs : rawFiles.filter(Boolean);

    const seenBuffers = new Set<string>();
    const uniqueFiles: any[] = [];
    for (const f of filesToUse) {
      if (!f || !f.buffer) continue;
      const hash = `${f.size || f.buffer.length}:${f.buffer.slice(0, 64).toString('hex')}`;
      if (!seenBuffers.has(hash)) {
        seenBuffers.add(hash);
        uniqueFiles.push(f);
      }
    }

    const validReceipts: { receipt: any; file: any }[] = [];
    if (!isCash && uniqueFiles.length > 0) {
      for (const f of uniqueFiles) {
        if (!f) continue;
        try {
          const receipt = await validateReceipt(f);
          if (receipt) validReceipts.push({ receipt, file: f });
        } catch (e: any) {
          if (uniqueFiles.length === 1) throw e;
        }
      }
    }

    // Fallback de ultra-seguridad: si la conexión celular no pasó los archivos multipart pero envió base64
    if (!isCash && validReceipts.length === 0) {
      const base64List: string[] = [];
      if (typeof data.proofsBase64 === 'string') {
        try {
          const parsed = JSON.parse(data.proofsBase64);
          if (Array.isArray(parsed)) base64List.push(...parsed);
          else if (typeof parsed === 'string') base64List.push(parsed);
        } catch {}
      }
      if (base64List.length === 0 && typeof data.proofBase64 === 'string') {
        base64List.push(data.proofBase64);
      }
      for (const b64 of base64List) {
        if (typeof b64 === 'string' && b64.startsWith('data:')) {
          const parts = b64.split(',');
          const mime = parts[0].split(';')[0].replace('data:', '') || 'image/jpeg';
          const buffer = Buffer.from(parts[1], 'base64');
          if (buffer.length > 0) {
            try {
              const receipt = await validateReceipt({ buffer, mimetype: mime, originalname: 'comprobante.jpg' });
              if (receipt) validReceipts.push({ receipt, file: { originalname: 'comprobante.jpg' } });
            } catch (err) {}
          }
        }
      }
    }

    if (isTransfer && validReceipts.length === 0) {
      throw new BadRequestException('Para pagos por transferencia es obligatorio adjuntar la foto del comprobante.');
    }
    if (isMixed && validReceipts.length === 0) {
      throw new BadRequestException('Para pagos mixtos es obligatorio adjuntar la foto del comprobante de transferencia.');
    }

    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Monto de pago inválido');

    let cashPart = 0;
    let transferPart = 0;
    if (isCash) {
      cashPart = amount;
    } else if (isTransfer) {
      transferPart = amount;
    } else if (isMixed) {
      cashPart = Number(data.cashAmount) || 0;
      transferPart = Number(data.transferAmount) || 0;
      if (cashPart <= 0 || transferPart <= 0) {
        throw new BadRequestException('En pago mixto debes ingresar un monto en efectivo y un monto en transferencia');
      }
      if (Math.abs((cashPart + transferPart) - amount) > 0.01) {
        throw new BadRequestException('La suma de efectivo y transferencia debe coincidir exactamente con el total');
      }
    }

    const settlementId = typeof data.clientMutationId === 'string' && data.clientMutationId.trim() && data.clientMutationId.length <= 100 ? data.clientMutationId : randomUUID();
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const table = await this.findTable(tableId, tx);
      const repeated = await tx.payment.findMany({ where: { settlementId }, include: { order: true } });
      if (repeated.length) {
        if (repeated.some(p => p.order.tableId !== tableId || p.method !== data.method) || Math.abs(repeated.reduce((sum, p) => sum + p.amount, 0) - amount) > 0.01) {
          throw new BadRequestException('El identificador de cobro ya está en uso');
        }
        return { table, payment: repeated[0], replay: true };
      }
      if (table.status !== 'OPEN') throw new BadRequestException('La cuenta está cerrada');
      if (!await this.getActiveClosing(user.id, table.cashRegisterId, tx)) throw new BadRequestException('Abre la caja antes de cobrar');
      const orders = table.orders.filter((order: any) => order.status !== 'CANCELLED' && order.paymentStatus !== 'CONFIRMED');
      if (!orders.length) throw new BadRequestException('La cuenta ya está pagada');
      if (orders.some((order: any) => order.paymentStatus === 'PENDING_REVIEW')) throw new BadRequestException('Ya hay un comprobante pendiente de revisión');
      if (Math.abs(amount - table.balance) > 0.01) throw new BadRequestException('El monto debe coincidir con el saldo completo. Actualiza la cuenta y vuelve a intentar.');
      const status = 'PENDING_REVIEW';
      const payments: any[] = [];
      for (const order of orders) {
        const orderRatio = amount > 0 ? (order.total / amount) : 1;
        const orderCash = isCash ? order.total : isMixed ? (orders.length === 1 ? cashPart : orderRatio * cashPart) : 0;
        const orderTransfer = isCash ? 0 : isMixed ? (orders.length === 1 ? transferPart : orderRatio * transferPart) : order.total;

        const payment = await tx.payment.update({ where: { orderId: order.id }, data: {
          amount: order.total, method: data.method, settlementId, status,
          cashAmount: orderCash, transferAmount: orderTransfer,
          reference: String(data.reference || '').slice(0, 300) || null,
          confirmedBy: null, confirmedAt: null,
        } });
        payments.push(payment);
        await tx.order.update({ where: { id: order.id }, data: {
          paymentMethod: data.method, paymentStatus: status,
          cashAmount: orderCash, transferAmount: orderTransfer,
          paymentReference: payment.reference,
        } });
      }
      if (validReceipts.length > 0) {
        // Almacenar todos los comprobantes adjuntos (una o varias fotos)
        for (const { receipt, file } of validReceipts) {
          await tx.transferProof.create({ data: {
            paymentId: payments[0].id, orderId: orders[0].id, tableId,
            cashClosingId: table.cashClosingId, submittedById: user.id,
            amount, method: data.method, status: 'PENDING', filePath: null,
            fileBase64: `data:${receipt.mime};base64,${receipt.bytes.toString('base64')}`,
            mimeType: receipt.mime, fileSize: receipt.bytes.length,
            originalName: String(file?.originalname || 'comprobante.jpg').slice(0, 200),
          } });
        }
      } else {
        // Cobro en efectivo o mixto registrado por mesera para validación en caja
        await tx.transferProof.create({ data: {
          paymentId: payments[0].id, orderId: orders[0].id, tableId,
          cashClosingId: table.cashClosingId, submittedById: user.id,
          amount, method: data.method, status: 'PENDING', filePath: null,
          fileBase64: null, mimeType: null, fileSize: null,
          originalName: isCash ? 'Cobro en Efectivo (Mesera)' : 'Cobro Mixto (Mesera)',
        } });
      }
      return { table: await this.findTable(tableId, tx), payment: payments[0], replay: false };
    }, operationTransaction);
    if (!result.replay) {
      this.socketGateway.emitPaymentSubmitted(result);
      this.emitAccount(result.table);
    }
    return result;
  }

  async listPaymentValidation(status = 'PENDING_REVIEW', method = 'ALL') {
    const payments = await this.prisma.payment.findMany({
      where: { status: status === 'ALL' ? undefined : status, order: { tableId: { not: null } },
        ...(method === 'CASH' ? { method: 'CASH' } : method === 'TRANSFER' ? { method: 'TRANSFER' } : method === 'MIXED' ? { method: 'MIXED' } : {}),
      },
      include: {
        order: {
          include: {
            diningTable: { include: { openedBy: { select: { id: true, name: true } } } },
            waiter: { select: { id: true, name: true } },
          },
        },
        transferProofs: {
          select: {
            ...receiptSummary,
            submittedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' }, take: 250,
    });
    const grouped = new Map<string, any>();
    for (const payment of payments) {
      const key = payment.settlementId || payment.id;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          ...payment,
          orderCount: 1,
          transferProofs: payment.transferProofs ? [...payment.transferProofs] : [],
        });
      } else {
        current.amount += payment.amount;
        current.cashAmount = (current.cashAmount || 0) + (payment.cashAmount || 0);
        current.transferAmount = (current.transferAmount || 0) + (payment.transferAmount || 0);
        current.orderCount++;
        if (payment.transferProofs && payment.transferProofs.length) {
          const existingIds = new Set((current.transferProofs || []).map((p: any) => p.id));
          for (const p of payment.transferProofs) {
            if (!existingIds.has(p.id)) {
              existingIds.add(p.id);
              current.transferProofs.push(p);
            }
          }
        }
      }
    }
    return [...grouped.values()];
  }

  async proofImage(proofId: string) {
    const proof = await this.prisma.transferProof.findUnique({ where: { id: proofId } });
    if (!proof) throw new NotFoundException('Comprobante no encontrado');
    return proof;
  }

  async reviewPayment(paymentId: string, action: 'CONFIRMED' | 'REJECTED', user: any, reason?: string) {
    if (!['CONFIRMED', 'REJECTED'].includes(action)) throw new BadRequestException('Acción inválida');
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
      if (!payment?.order.tableId) throw new NotFoundException('Cobro de cuenta no encontrado');
      if (payment.status === action) return { payment, table: await this.findTable(payment.order.tableId, tx), replay: true };

      // Permitir confirmar pagos en PENDING_REVIEW o validar/aceptar pagos previamente REJECTED
      const allowedFrom = ['PENDING_REVIEW'];
      if (action === 'CONFIRMED') allowedFrom.push('REJECTED');
      if (!allowedFrom.includes(payment.status)) throw new BadRequestException('Este pago ya fue validado y confirmado');

      const closing = await this.getActiveClosing(user.id, payment.order.cashRegisterId, tx);
      if (!closing) throw new BadRequestException('Abre la caja antes de validar');
      const defaultRegister = await tx.cashRegister.findFirst({ where: { active: true } });
      const targetRegisterId = payment.order.cashRegisterId || closing.cashRegisterId || defaultRegister?.id || null;

      const group = await tx.payment.findMany({ where: payment.settlementId ? { settlementId: payment.settlementId } : { id: paymentId } });
      if (group.some(p => !allowedFrom.includes(p.status))) throw new BadRequestException('Actualiza la cuenta: uno de los pagos ya cambió');
      const ids = group.map(p => p.id);

      await tx.payment.updateMany({ where: { id: { in: ids } }, data: {
        status: action, confirmedBy: user.id, confirmedAt: action === 'CONFIRMED' ? new Date() : null,
      } });
      await tx.order.updateMany({
        where: { id: { in: group.map(p => p.orderId) } },
        data: {
          paymentStatus: action,
          ...(targetRegisterId ? { cashRegisterId: targetRegisterId } : {}),
        },
      });

      const proofsCount = await tx.transferProof.count({ where: { paymentId: { in: ids } } });
      if (proofsCount > 0) {
        await tx.transferProof.updateMany({ where: { paymentId: { in: ids } }, data: {
          status: action, reviewedById: user.id, reviewedAt: new Date(),
          rejectionReason: action === 'REJECTED' ? String(reason || 'Rechazado por caja').slice(0, 500) : null,
        } });
      }

      return { payment: { ...payment, status: action }, table: await this.finishPaidTable(payment.order.tableId, tx), replay: false };
    }, operationTransaction);
    if (!result.replay) {
      if (action === 'CONFIRMED') this.socketGateway.emitPaymentValidated(result);
      else this.socketGateway.emitPaymentRejected(result.table.openedById, { ...result, reason });
      this.emitAccount(result.table);
    }
    return result;
  }

  async closeTable(tableId: string, user: any) {
    const table = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const table = await this.findTable(tableId, tx);
      if (table.kitchenStatus === 'ACTIVE') throw new BadRequestException('Hay productos pendientes en cocina');
      if (table.balance > 0 || !table.orders.length) throw new BadRequestException('La cuenta tiene pago pendiente');
      return this.finishPaidTable(tableId, tx);
    }, operationTransaction);
    this.emitAccount(table);
    return table;
  }

  async purgeProofsForClosing(cashClosingId?: string) {
    // Al cerrar la caja (cierre de turno), liberamos inmediatamente los bytes de imágenes (fileBase64)
    // para que la base de datos de PostgreSQL y los servidores nunca se llenen de almacenamiento.
    // Todos los datos contables (montos, referencias, mesera, cajero, hora, reporte Z) se conservan intactos.
    try {
      if (!cashClosingId) return;

      const closing = await this.prisma.cashClosing.findUnique({
        where: { id: cashClosingId },
      });

      await this.prisma.transferProof.updateMany({
        where: {
          fileBase64: { not: null },
          OR: [
            { cashClosingId },
            { table: { cashClosingId } },
            ...(closing?.shiftStart ? [{ createdAt: { gte: closing.shiftStart, lte: closing.shiftEnd } }] : []),
          ],
        },
        data: {
          fileBase64: null,
          purgedAt: new Date(),
        },
      });
    } catch (err: any) {
      console.warn('[purgeProofsForClosing] Error al purgar imágenes al cerrar caja:', err?.message);
    }
  }

  async assertNoOpenTableWork(cashRegisterId?: string) {
    const openTables = await this.prisma.diningTable.count({
      where: { status: 'OPEN', orders: { some: {} }, ...(cashRegisterId ? { cashRegisterId } : {}) },
    });
    if (openTables > 0) throw new BadRequestException(`No se puede cerrar la caja. Hay ${openTables} mesa(s) abierta(s).`);
    const pendingTickets = await this.prisma.kitchenTicket.count({
      where: { status: { in: ACTIVE_KITCHEN }, ...(cashRegisterId ? { table: { cashRegisterId } } : {}) },
    });
    if (pendingTickets > 0) throw new BadRequestException(`No se puede cerrar la caja. Hay ${pendingTickets} ticket(s) de cocina pendientes.`);
    const pendingPayments = await this.prisma.payment.count({
      where: { status: { in: PENDING_PAYMENT }, order: { orderType: 'LOCAL', ...(cashRegisterId ? { cashRegisterId } : {}) } },
    });
    if (pendingPayments > 0) throw new BadRequestException(`No se puede cerrar la caja. Hay ${pendingPayments} pago(s) de mesa pendientes de validar.`);
  }
}
