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
    const where: any = cashRegisterId ? { cashRegisterId, isOpen: true } : { isOpen: true };
    if (!cashRegisterId) {
      const own = await db.cashClosing.findFirst({
        where: { userId, isOpen: true },
        orderBy: { shiftStart: 'desc' },
      });
      if (own) return own;
    }
    return db.cashClosing.findFirst({ where, orderBy: { shiftStart: 'desc' } });
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
    if (params.waiterId) where.openedById = params.waiterId;
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
    const defaultRegister = !closing ? await this.prisma.cashRegister.findFirst() : null;
    const table = await this.prisma.diningTable.create({
      data: {
        label: data.label.trim(),
        notes: data.notes,
        openedById: user.id,
        cashRegisterId: closing?.cashRegisterId || data.cashRegisterId || defaultRegister?.id || null,
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
      const label = typeof data.tableLabel === 'string' ? data.tableLabel.trim() : '';
      if (!data.tableId && (!label || label.length > 80)) throw new BadRequestException('Escribe un nombre de cuenta de 1 a 80 caracteres');
      let table = data.tableId ? await tx.diningTable.findUnique({ where: { id: data.tableId } }) : null;
      if (data.tableId && !table) throw new NotFoundException('Cuenta no encontrada');
      if (table && table.status !== 'OPEN') throw new BadRequestException('La cuenta ya está cerrada');
      const closing = await this.getActiveClosing(user.id, table?.cashRegisterId || data.cashRegisterId, tx);
      if (!closing) throw new BadRequestException('Abre una caja antes de enviar pedidos');
      if (!table) {
        table = await tx.diningTable.create({ data: {
          label, openedById: user.id, cashRegisterId: closing.cashRegisterId, cashClosingId: closing.id,
        } });
      }
      if (await tx.payment.count({ where: { order: { tableId: table.id }, status: 'PENDING_REVIEW' } })) {
        throw new BadRequestException('Espera a que caja revise el pago antes de agregar productos');
      }
      const order = await this.ordersService.createWithinTransaction({
        customerName: table.label, customerPhone: '3000000000', customerAddress: table.label,
        notes: data.notes, items: (data.items || []).map((item: any) => ({ menuItemId: item.menuItemId, quantity: item.quantity, notes: item.notes })),
        waiterId: user.id, userId: user.id, userRole: user.role, orderType: 'LOCAL',
        source: data.offline ? 'OFFLINE_TABLE' : 'TABLE', paymentMethod: 'CASH',
        cashRegisterId: table.cashRegisterId, tableId: table.id, clientMutationId,
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

  private buildChangeSummary(before: any[], after: any[]) {
    const key = (item: any) => item.menuItemId;
    const beforeMap = new Map(before.map(item => [key(item), item]));
    const afterMap = new Map(after.map(item => [key(item), item]));
    const changeMap = new Map<string, any>();
    const parts: string[] = [];

    for (const item of after) {
      const prev = beforeMap.get(key(item));
      if (!prev) {
        parts.push(`Nuevo: ${item.quantity} x ${item.name || item.menuItem?.name || 'Producto'}`);
        changeMap.set(item.menuItemId, { changeType: 'ADDED' });
      } else if (Number(prev.quantity) !== Number(item.quantity) || String(prev.notes || '').trim() !== String(item.notes || '').trim()) {
        parts.push(`Editado: ${item.name || item.menuItem?.name || 'Producto'} (${prev.quantity} -> ${item.quantity})`);
        changeMap.set(item.menuItemId, { changeType: 'MODIFIED', previousQty: prev.quantity, previousNotes: prev.notes });
      } else {
        changeMap.set(item.menuItemId, { changeType: 'UNCHANGED' });
      }
    }

    for (const item of before) {
      if (!afterMap.has(key(item))) {
        parts.push(`Quitado: ${item.menuItem?.name || 'Producto'}`);
        changeMap.set(item.menuItemId, { changeType: 'REMOVED', previousQty: item.quantity, previousNotes: item.notes });
      }
    }

    return { summary: parts.join(' | ') || 'Pedido editado sin cambios de productos', changeMap };
  }

  async updateTableOrder(orderId: string, data: any, user: any) {
    const tickets: any[] = [];
    const result = await this.prisma.$transaction(async tx => {
      await lockOperation(tx);
      const existing = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { menuItem: true } }, diningTable: true } });
      if (!existing?.tableId) throw new NotFoundException('Pedido de mesa no encontrado');
      if (existing.diningTable?.status !== 'OPEN') throw new BadRequestException('La cuenta está cerrada');
      const { summary, changeMap } = this.buildChangeSummary(existing.items, data.items || []);
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
    tickets.forEach(event => event.created ? this.socketGateway.emitKitchenTicketCreated(event.ticket) : this.socketGateway.emitKitchenTicketUpdated(event.ticket));
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
    const users = (station?.users || []).filter(u => u.active);
    if (users.length === 0) return null;
    const loads = await Promise.all(users.map(async user => {
      const tickets = await db.kitchenTicket.findMany({
        where: { stationId, assignedToId: user.id, status: { in: ACTIVE_KITCHEN } },
        include: { items: true },
      });
      const pendingUnits = tickets.reduce((acc, t) => acc + (t.items || []).reduce((sum, i) => sum + (i.changeType !== 'REMOVED' ? i.quantity : 0), 0), 0);
      return { user, pendingUnits, ticketCount: tickets.length };
    }));
    loads.sort((a, b) => a.pendingUnits - b.pendingUnits || a.ticketCount - b.ticketCount || a.user.name.localeCompare(b.user.name));
    return loads[0].user.id;
  }

  private isDrinkOrSideCategory(categoryName: string): boolean {
    const lower = (categoryName || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return (
      lower.includes('bebida') ||
      lower.includes('gaseosa') ||
      lower.includes('jugo') ||
      lower.includes('agua') ||
      lower.includes('refresco') ||
      lower.includes('soda') ||
      lower.includes('cerveza') ||
      lower.includes('adicion')
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
      smartDrinkRouting: true,
      multiStationDrinkTarget: 'general',
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

    const drinkStation = eligibleStations.find(s => /bebida|jugo|bar/i.test(s.name)) || generalStation;

    // 2. Clasificar items en Comida vs Bebidas/Acompañamientos
    const foodItems: any[] = [];
    const drinkItems: any[] = [];

    for (const item of order.items) {
      const catName = item.menuItem?.category?.name || '';
      if (this.isDrinkOrSideCategory(catName)) {
        drinkItems.push(item);
      } else {
        foodItems.push(item);
      }
    }

    // 3. Agrupar comida en sus estaciones respectivas
    const stationGroups = new Map<string, any[]>();
    const foodStationsSet = new Set<string>();

    for (const item of foodItems) {
      const categoryId = item.menuItem.categoryId;
      const targetStation = eligibleStations.find(s => s.categories.some(c => c.id === categoryId)) || generalStation;
      foodStationsSet.add(targetStation.id);

      if (!stationGroups.has(targetStation.id)) stationGroups.set(targetStation.id, []);
      stationGroups.get(targetStation.id)!.push(item);
    }

    // 4. Regla inteligente de Bebidas (sin duplicaciones):
    if (drinkItems.length > 0) {
      if (foodStationsSet.size === 1 && settings.smartDrinkRouting !== false) {
        // Caso A: Solo una estación de comida (ej: hamburguesa + gaseosa) -> acompañar a esa estación
        const singleStationId = Array.from(foodStationsSet)[0];
        if (!stationGroups.has(singleStationId)) stationGroups.set(singleStationId, []);
        stationGroups.get(singleStationId)!.push(...drinkItems);
      } else if (foodStationsSet.size > 1) {
        // Caso B: Múltiples estaciones (ej: 1 hamburguesa + 1 perro + 1 gaseosa)
        // Regla The Villa Dog: Las bebidas van primordialmente a la estación de Perros Calientes, SIN salir en Hamburguesas
        const perroStation = eligibleStations.find(s => /perro/i.test(s.name));
        const targetId = perroStation ? perroStation.id : Array.from(foodStationsSet)[0];
        if (!stationGroups.has(targetId)) stationGroups.set(targetId, []);
        stationGroups.get(targetId)!.push(...drinkItems);
      } else {
        // Caso C: Solo bebidas en el pedido -> estación de perros primordialmente
        const perroStation = eligibleStations.find(s => /perro/i.test(s.name));
        const targetId = perroStation ? perroStation.id : generalStation.id;
        if (!stationGroups.has(targetId)) stationGroups.set(targetId, []);
        stationGroups.get(targetId)!.push(...drinkItems);
      }
    }

    // 5. Al editar: incorporar items cancelados/eliminados a su estación correspondiente para alertar a cocina
    if (isEdited && removedCandidateItems && changeMap) {
      for (const oldItem of removedCandidateItems) {
        if (changeMap.get(oldItem.menuItemId)?.changeType === 'REMOVED') {
          const catName = oldItem.menuItem?.category?.name || '';
          let targetStation = generalStation;
          if (this.isDrinkOrSideCategory(catName)) {
            const perroStation = eligibleStations.find(s => /perro/i.test(s.name));
            targetStation = perroStation || generalStation;
          } else {
            targetStation = eligibleStations.find(s => s.categories.some(c => c.id === oldItem.menuItem?.categoryId)) || generalStation;
          }
          if (!stationGroups.has(targetStation.id)) stationGroups.set(targetStation.id, []);
          stationGroups.get(targetStation.id)!.push({
            ...oldItem,
            isRemovedItem: true,
          });
        }
      }
    }

    const tickets: any[] = [];
    for (const [stationId, items] of stationGroups.entries()) {
      // Buscar si YA EXISTE un ticket activo para este pedido y estación (UNA SOLA TARJETA)
      let existingTicket: any = null;
      if (isEdited) {
        existingTicket = await db.kitchenTicket.findFirst({
          where: {
            orderId,
            stationId,
            status: { in: ['NEW', 'PREPARING', 'READY'] },
          },
          include: { items: true },
        });
      }

      // Preparar los items actuales con su tipo de cambio exacto
      const ticketItemsData = items.map(item => {
        const changeInfo = changeMap?.get(item.menuItemId);
        let changeType = 'UNCHANGED';
        if (item.isRemovedItem || changeInfo?.changeType === 'REMOVED') {
          changeType = 'REMOVED';
        } else if (changeInfo?.changeType === 'ADDED') {
          changeType = 'ADDED';
        } else if (changeInfo?.changeType === 'MODIFIED') {
          changeType = 'MODIFIED';
        } else if (isEdited) {
          // Si el pedido es editado pero este producto no cambió, se conserva UNCHANGED
          changeType = 'UNCHANGED';
        }

        return {
          orderItemId: item.isRemovedItem ? null : (item.id || null),
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          nameSnapshot: item.menuItem?.name || item.nameSnapshot || 'Producto',
          notes: item.notes || null,
          changeType,
          previousQty: changeInfo?.previousQty || null,
          previousNotes: changeInfo?.previousNotes || null,
        };
      });

      const hasActiveItems = ticketItemsData.some(i => i.changeType !== 'REMOVED');

      if (existingTicket) {
        // ACTUALIZAR LA TARJETA EXISTENTE (no crear duplicados)
        await db.kitchenTicketItem.deleteMany({ where: { ticketId: existingTicket.id } });

        let newStatus = existingTicket.status;
        if (!hasActiveItems) {
          newStatus = 'CANCELLED';
        } else if (existingTicket.status === 'READY') {
          newStatus = 'PREPARING';
        }

        const updatedTicket = await db.kitchenTicket.update({
          where: { id: existingTicket.id },
          data: {
            isEdited: true,
            changeSummary: changeSummary || 'Pedido editado',
            status: newStatus,
            items: {
              create: ticketItemsData,
            },
          },
          include: { station: true, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
        });
        tickets.push(updatedTicket);
        if (events) events.push({ created: false, ticket: updatedTicket }); else this.socketGateway.emitKitchenTicketUpdated(updatedTicket);
      } else {
        // CREAR TICKET NUEVO (primera vez para esta estación)
        const assignedToId = await this.pickCook(stationId, db);
        const newStatus = hasActiveItems ? 'NEW' : 'CANCELLED';
        const newTicket = await db.kitchenTicket.create({
          data: {
            orderId,
            tableId: order.tableId,
            stationId,
            assignedToId,
            isEdited,
            changeSummary: changeSummary || (isEdited ? 'Pedido editado' : null),
            status: newStatus,
            items: {
              create: ticketItemsData,
            },
          },
          include: { station: true, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
        });
        tickets.push(newTicket);
        if (events) events.push({ created: true, ticket: newTicket }); else this.socketGateway.emitKitchenTicketCreated(newTicket);
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
      const ticket = await tx.kitchenTicket.findUnique({ where: { id: ticketId }, include: { order: true } });
      if (!ticket) throw new NotFoundException('Ticket no encontrado');
      if (ticket.tableId) {
        const table = await tx.diningTable.findUnique({ where: { id: ticket.tableId } });
        if (table?.status === 'CLOSED' && ticket.status !== status) throw new BadRequestException('La cuenta ya está cerrada');
      }
      const transitions: Record<string, string[]> = { NEW: ['PREPARING', 'READY'], PREPARING: ['READY'], READY: ['SERVED'], SERVED: [], CANCELLED: [] };
      if (ticket.status !== status && !transitions[ticket.status]?.includes(status)) throw new BadRequestException('El pedido cambió. Actualiza cocina antes de continuar.');
      const updated = await tx.kitchenTicket.update({ where: { id: ticketId }, data: {
        status, assignedToId: ticket.assignedToId || user.id,
        ...(status === 'PREPARING' ? { startedAt: ticket.startedAt || new Date() } : {}),
        ...(status === 'READY' ? { readyAt: ticket.readyAt || new Date() } : {}),
        ...(status === 'SERVED' ? { servedAt: ticket.servedAt || new Date() } : {}),
      }, include: { station: true, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } } });
      const active = await tx.kitchenTicket.count({ where: { orderId: ticket.orderId, status: { in: ACTIVE_KITCHEN } } });
      await tx.order.update({ where: { id: ticket.orderId }, data: { kitchenStatus: active ? 'ACTIVE' : 'READY' } });
      return { updated, table: ticket.tableId ? await this.finishPaidTable(ticket.tableId, tx) : null };
    }, operationTransaction);
    this.socketGateway.emitKitchenTicketUpdated(result.updated);
    if (status === 'READY') this.socketGateway.emitKitchenTicketReady(result.updated.order.waiterId, result.updated);
    if (result.table) this.emitAccount(result.table);
    return result.updated;
  }

  async listKitchenTickets(user: any, params: { status?: string; stationId?: string }) {
    const where: any = {};
    if (params.status) {
      where.status = params.status;
    } else {
      where.status = { in: ['NEW', 'PREPARING', 'READY'] };
    }
    if (params.stationId) where.stationId = params.stationId;
    if (!['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user.role)) {
      where.OR = [{ assignedToId: user.id }, { station: { users: { some: { id: user.id } } } }];
    }
    const tickets = await this.prisma.kitchenTicket.findMany({
      where,
      include: { station: true, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 250,
    });

    // Garantizar que cada orden y estación tenga una sola tarjeta activa visible
    const seen = new Set<string>();
    const deduped: typeof tickets = [];
    for (const t of tickets) {
      const key = `${t.orderId}_${t.stationId}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(t);
      }
    }
    return deduped;
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

  async submitPayment(tableId: string, data: any, user: any, file?: any) {
    if (!['CASH', 'TRANSFER'].includes(data.method)) throw new BadRequestException('Método de pago inválido');
    const isCash = data.method === 'CASH';
    const receipt = isCash ? null : validateReceipt(file);
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Monto de pago inválido');
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
      const status = isCash ? 'CONFIRMED' : 'PENDING_REVIEW';
      const payments: any[] = [];
      for (const order of orders) {
        const payment = await tx.payment.update({ where: { orderId: order.id }, data: {
          amount: order.total, method: data.method, settlementId, status,
          cashAmount: isCash ? order.total : 0, transferAmount: isCash ? 0 : order.total,
          reference: String(data.reference || '').slice(0, 300) || null,
          confirmedBy: isCash ? user.id : null, confirmedAt: isCash ? new Date() : null,
        } });
        payments.push(payment);
        await tx.order.update({ where: { id: order.id }, data: {
          paymentMethod: data.method, paymentStatus: status,
          cashAmount: isCash ? order.total : 0, transferAmount: isCash ? 0 : order.total,
          paymentReference: payment.reference,
        } });
      }
      if (receipt) {
        // One compressed image per account payment, stored durably in PostgreSQL.
        // This works through Railway redeployments without duplicating ephemeral files.
        await tx.transferProof.create({ data: {
          paymentId: payments[0].id, orderId: orders[0].id, tableId,
          cashClosingId: table.cashClosingId, submittedById: user.id,
          amount, method: data.method, status: 'PENDING', filePath: null,
          fileBase64: `data:${receipt.mime};base64,${receipt.bytes.toString('base64')}`,
          mimeType: receipt.mime, fileSize: receipt.bytes.length,
          originalName: String(file.originalname || 'comprobante.jpg').slice(0, 200),
        } });
      }
      return { table: await this.finishPaidTable(tableId, tx), payment: payments[0], replay: false };
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
        ...(method === 'CASH' ? { method: 'CASH' } : method === 'TRANSFER' ? { method: { not: 'CASH' } } : {}),
      },
      include: {
        order: { include: { diningTable: true, waiter: { select: { id: true, name: true } } } },
        transferProofs: { select: receiptSummary, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' }, take: 250,
    });
    const grouped = new Map<string, any>();
    for (const payment of payments) {
      const key = payment.settlementId || payment.id;
      const current = grouped.get(key);
      if (!current) grouped.set(key, { ...payment, orderCount: 1 });
      else {
        current.amount += payment.amount;
        current.orderCount++;
        if (payment.transferProofs.length) {
          current.id = payment.id;
          current.transferProofs = payment.transferProofs;
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
      if (payment.status !== 'PENDING_REVIEW') throw new BadRequestException('Este pago ya fue revisado');
      if (!await this.getActiveClosing(user.id, payment.order.cashRegisterId, tx)) throw new BadRequestException('Abre la caja antes de validar');
      const group = await tx.payment.findMany({ where: payment.settlementId ? { settlementId: payment.settlementId } : { id: paymentId } });
      if (group.some(p => p.status !== 'PENDING_REVIEW')) throw new BadRequestException('Actualiza la cuenta: uno de los pagos ya cambió');
      const ids = group.map(p => p.id);
      const pendingProofs = await tx.transferProof.count({ where: { paymentId: { in: ids }, status: 'PENDING' } });
      if (!pendingProofs) throw new BadRequestException('No hay comprobante pendiente para este cobro');
      await tx.payment.updateMany({ where: { id: { in: ids } }, data: {
        status: action, confirmedBy: user.id, confirmedAt: action === 'CONFIRMED' ? new Date() : null,
      } });
      await tx.order.updateMany({ where: { id: { in: group.map(p => p.orderId) } }, data: { paymentStatus: action } });
      await tx.transferProof.updateMany({ where: { paymentId: { in: ids }, status: 'PENDING' }, data: {
        status: action, reviewedById: user.id, reviewedAt: new Date(),
        rejectionReason: action === 'REJECTED' ? String(reason || 'Rechazado por caja').slice(0, 500) : null,
      } });
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

  async purgeProofsForClosing(_cashClosingId: string) {
    // Preserve receipts after checkout; expire image bytes only after the configured retention.
    // The amount, review status and audit metadata are always kept.
    const days = Number(process.env.RECEIPT_RETENTION_DAYS || 30);
    if (!Number.isFinite(days) || days < 1) return;
    const before = new Date(Date.now() - days * 86400000);
    await this.prisma.transferProof.updateMany({
      where: { createdAt: { lt: before }, status: { in: ['CONFIRMED', 'REJECTED'] }, purgedAt: null, table: { status: 'CLOSED' } },
      data: { fileBase64: null, purgedAt: new Date() },
    });
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
