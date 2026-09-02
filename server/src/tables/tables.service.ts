import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
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

  private async getActiveClosing(userId: string, cashRegisterId?: string) {
    const where: any = cashRegisterId ? { cashRegisterId, isOpen: true } : { isOpen: true };
    if (!cashRegisterId) {
      const own = await this.prisma.cashClosing.findFirst({
        where: { userId, isOpen: true },
        orderBy: { shiftStart: 'desc' },
      });
      if (own) return own;
    }
    return this.prisma.cashClosing.findFirst({ where, orderBy: { shiftStart: 'desc' } });
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
        include: {
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
    const where: any = {};
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

  async findTable(id: string) {
    const table = await this.prisma.diningTable.findUnique({ where: { id }, include: this.buildTableInclude() });
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
    try {
      const clientMutationId = data.clientMutationId || randomUUID();
      const existing = await this.prisma.order.findUnique({
        where: { clientMutationId },
        include: this.buildOrderInclude(),
      }).catch(() => null);
      if (existing) {
        this.socketGateway.server.to(`user:${user.id}`).emit('offlineOrderSynced', existing);
        return existing;
      }

      let table = data.tableId
        ? await this.findTable(data.tableId)
        : await this.prisma.diningTable.findFirst({
            where: {
              label: { equals: data.tableLabel?.trim(), mode: 'insensitive' },
              status: 'OPEN',
            },
            include: this.buildTableInclude(),
          });

      if (!table && data.tableLabel?.trim()) {
        table = await this.createTable({ label: data.tableLabel, notes: data.tableNotes, cashRegisterId: data.cashRegisterId }, user);
      }
      if (!table) throw new BadRequestException('Debes indicar una mesa válida');
      if (table.status !== 'OPEN') throw new BadRequestException('La mesa ya no esta abierta');

      const order = await this.ordersService.create({
        customerName: data.tableLabel || table.label,
        customerPhone: '3000000000',
        customerAddress: table.label,
        notes: data.notes,
        items: data.items || [],
        waiterId: user.id,
        userId: user.id,
        userRole: user.role,
        orderType: 'LOCAL',
        source: data.offline ? 'OFFLINE_TABLE' : 'TABLE',
        paymentMethod: data.paymentMethod || 'CASH',
        cashAmount: data.cashAmount,
        transferAmount: data.transferAmount,
        paymentReference: data.paymentReference,
        cashRegisterId: table.cashRegisterId,
        tableId: table.id,
        clientMutationId,
      });

      await this.createKitchenTickets(order.id, user.id, false, data.changeSummary);
      const full = await this.findTable(table.id);
      this.socketGateway.server.emit('tableOrderSubmitted', { table: full, order });
      this.socketGateway.emitTableUpdated(full);
      this.socketGateway.server.to(`user:${user.id}`).emit('offlineOrderSynced', order);
      return { table: full, order };
    } catch (err) {
      console.error('CRITICAL ERROR in createTableOrder:', err);
      throw err;
    }
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
    const existing = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: true } }, diningTable: true },
    });
    if (!existing?.tableId) throw new NotFoundException('Pedido de mesa no encontrado');

    const menuItems = await this.prisma.menuItem.findMany({ where: { id: { in: (data.items || []).map((i: any) => i.menuItemId) } } });
    const names = new Map(menuItems.map(i => [i.id, i.name]));
    const after = (data.items || []).map((item: any) => ({ ...item, name: names.get(item.menuItemId) }));
    const { summary, changeMap } = this.buildChangeSummary(existing.items, after);

    const updated = await this.ordersService.update(orderId, {
      customerName: existing.customerName,
      customerPhone: existing.customerPhone,
      customerAddress: existing.customerAddress,
      notes: data.notes ?? existing.notes,
      items: data.items || [],
      paymentMethod: existing.paymentMethod,
      orderType: 'LOCAL',
    });

    // Actualizar los tickets existentes de cocina sin duplicar tarjetas
    await this.createKitchenTickets(orderId, user.id, true, data.changeSummary || summary, changeMap, existing.items);
    const table = await this.findTable(existing.tableId);
    this.socketGateway.emitTableUpdated(table);
    return { table, order: updated, changeSummary: data.changeSummary || summary };
  }

  private async getStations() {
    let stations = await this.prisma.kitchenStation.findMany({
      where: { active: true },
      include: { categories: true, users: { select: { id: true, name: true } } },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
    if (stations.length === 0) {
      const cats = await this.prisma.menuCategory.findMany({ where: { active: true }, take: 2 });
      const created = await this.prisma.kitchenStation.create({
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

  private async pickCook(stationId: string) {
    const station = await this.prisma.kitchenStation.findUnique({
      where: { id: stationId },
      include: { users: true },
    });
    const users = (station?.users || []).filter(u => u.active);
    if (users.length === 0) return null;
    const loads = await Promise.all(users.map(async user => ({
      user,
      count: await this.prisma.kitchenTicket.count({
        where: { stationId, assignedToId: user.id, status: { in: ACTIVE_KITCHEN } },
      }),
    })));
    loads.sort((a, b) => a.count - b.count || a.user.name.localeCompare(b.user.name));
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

  async getKitchenSettings() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: 'kitchen_routing_settings' } });
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

  async createKitchenTickets(orderId: string, actorId: string, isEdited = false, changeSummary?: string, changeMap?: Map<string, any>, removedCandidateItems?: any[]) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: { include: { category: true } } } }, diningTable: true, waiter: true },
    });
    if (!order) throw new NotFoundException('Pedido de mesa no encontrado');

    const isSalon = !!(order.tableId || order.orderType === 'DINE_IN');
    const allActiveStations = await this.getStations();
    const settings = await this.getKitchenSettings();

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
        existingTicket = await this.prisma.kitchenTicket.findFirst({
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
        await this.prisma.kitchenTicketItem.deleteMany({ where: { ticketId: existingTicket.id } });

        let newStatus = existingTicket.status;
        if (!hasActiveItems) {
          newStatus = 'CANCELLED';
        } else if (existingTicket.status === 'READY') {
          newStatus = 'PREPARING';
        }

        const updatedTicket = await this.prisma.kitchenTicket.update({
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
        this.socketGateway.emitKitchenTicketUpdated(updatedTicket);
      } else {
        // CREAR TICKET NUEVO (primera vez para esta estación)
        const assignedToId = await this.pickCook(stationId);
        const newStatus = hasActiveItems ? 'NEW' : 'CANCELLED';
        const newTicket = await this.prisma.kitchenTicket.create({
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
        this.socketGateway.emitKitchenTicketCreated(newTicket);
      }
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { kitchenStatus: 'SENT', sentToKitchenAt: order.sentToKitchenAt || new Date() },
    });

    if (isEdited) {
      await this.prisma.orderChangeLog.create({
        data: {
          orderId,
          userId: actorId,
          summary: changeSummary || 'Pedido editado',
          changes: { summary: changeSummary || 'Pedido editado' },
        },
      });
      this.socketGateway.server.emit('tableOrderEdited', { orderId, changeSummary });
    }
    return tickets;
  }

  async updateKitchenTicket(ticketId: string, status: string, user: any) {
    if (!['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'].includes(status)) {
      throw new BadRequestException('Estado de cocina invalido');
    }
    const ticket = await this.prisma.kitchenTicket.findUnique({ where: { id: ticketId }, include: { order: true } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    const updated = await this.prisma.kitchenTicket.update({
      where: { id: ticketId },
      data: {
        status,
        assignedToId: ticket.assignedToId || user.id,
        ...(status === 'PREPARING' ? { startedAt: new Date() } : {}),
        ...(status === 'READY' ? { readyAt: new Date() } : {}),
        ...(status === 'SERVED' ? { servedAt: new Date() } : {}),
      },
      include: { station: true, assignedTo: { select: { id: true, name: true } }, items: true, order: { include: { waiter: true, diningTable: true } } },
    });
    this.socketGateway.emitKitchenTicketUpdated(updated);
    if (status === 'READY') {
      this.socketGateway.emitKitchenTicketReady(updated.order.waiterId, updated);
    }
    await this.refreshOrderKitchenStatus(ticket.orderId);
    return updated;
  }

  private async refreshOrderKitchenStatus(orderId: string) {
    const tickets = await this.prisma.kitchenTicket.findMany({ where: { orderId } });
    if (tickets.length === 0) return;
    const kitchenStatus = tickets.every(t => ['READY', 'SERVED'].includes(t.status)) ? 'READY' : 'ACTIVE';
    await this.prisma.order.update({
      where: { id: orderId },
      data: { kitchenStatus, ...(kitchenStatus === 'READY' ? { servedAt: new Date() } : {}) },
    });
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

  async submitPayment(tableId: string, data: any, user: any, file?: any) {
    const table = await this.findTable(tableId);
    const orders = (table.orders || []).filter((o: any) => o.status !== 'CANCELLED' && o.paymentStatus !== 'CONFIRMED');
    if (orders.length === 0) throw new BadRequestException('La mesa no tiene saldo pendiente');
    const order = orders[0];
    const amount = Number(data.amount || order.total || 0);
    const method = data.method === 'TRANSFER' ? 'TRANSFER' : 'CASH';

    // Si es Efectivo: se confirma de inmediato y se libera la mesa
    // Si es Transferencia: queda pendiente para validación del comprobante
    const isCash = method === 'CASH';
    const status = isCash ? 'CONFIRMED' : 'PENDING_REVIEW';

    const payment = await this.prisma.payment.update({
      where: { orderId: order.id },
      data: {
        method,
        amount,
        cashAmount: isCash ? amount : 0,
        transferAmount: isCash ? 0 : amount,
        reference: data.reference || null,
        status,
        confirmedBy: isCash ? user.id : null,
        confirmedAt: isCash ? new Date() : null,
      },
    });
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentMethod: method,
        paymentStatus: status,
        paymentReference: data.reference || null,
        ...(isCash ? { status: 'DELIVERED' } : {})
      },
    });

    let proof: any = null;
    if (!isCash || file) {
      proof = await this.storeProof({ paymentId: payment.id, orderId: order.id, tableId, amount, method, user, file });
    }

    let updatedTable = await this.findTable(tableId);

    // Auto-cerrar y liberar la mesa si ya está completamente pagada
    if (isCash && updatedTable.balance === 0) {
      const closed = await this.prisma.diningTable.update({
        where: { id: tableId },
        data: { status: 'CLOSED', closedAt: new Date() },
        include: this.buildTableInclude(),
      });
      updatedTable = this.summarizeTable(closed);
      this.socketGateway.emitTableClosed(updatedTable);
    } else {
      this.socketGateway.emitPaymentSubmitted({ table: updatedTable, payment, proof });
      this.socketGateway.emitTableUpdated(updatedTable);
    }

    return { table: updatedTable, payment, proof };
  }

  private async storeProof(input: { paymentId: string; orderId: string; tableId: string; amount: number; method: string; user: any; file?: any }) {
    if (!input.file) throw new BadRequestException('La foto del comprobante es obligatoria');
    if (!input.file.mimetype || (!input.file.mimetype.startsWith('image/') && !input.file.mimetype.includes('octet-stream'))) {
      throw new BadRequestException('Solo se permiten archivos de imagen');
    }
    if (input.file.size > 15 * 1024 * 1024) {
      throw new BadRequestException('La imagen no puede pesar más de 15MB');
    }
    const closing = await this.getActiveClosing(input.user.id);
    const closingId = closing?.id || 'general';

    const ext = input.file.mimetype === 'image/png' ? 'png' : input.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const filePath = join(process.env.DATA_DIR || join(process.cwd(), '.tmp'), 'transfer-proofs', closingId, `${randomUUID()}.${ext}`);
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, input.file.buffer);
    } catch (e) {
      console.warn('[storeProof] Error al escribir en disco:', e);
    }

    const fileBase64 = input.file.buffer
      ? `data:${input.file.mimetype || 'image/jpeg'};base64,${input.file.buffer.toString('base64')}`
      : null;

    return this.prisma.transferProof.create({
      data: {
        paymentId: input.paymentId,
        orderId: input.orderId,
        tableId: input.tableId,
        cashClosingId: closing?.id || null,
        submittedById: input.user.id,
        amount: input.amount,
        method: input.method,
        filePath,
        fileBase64,
        originalName: input.file.originalname || 'comprobante.jpg',
        mimeType: input.file.mimetype || 'image/jpeg',
        fileSize: input.file.size,
      },
      include: { table: true, order: true, payment: true, submittedBy: { select: { id: true, name: true } } },
    });
  }

  async listPaymentValidation(status = 'PENDING', method = 'ALL') {
    const payments = await this.prisma.payment.findMany({
      where: { status: status === 'ALL' ? undefined : status },
      include: {
        order: { include: { diningTable: true, waiter: { select: { id: true, name: true } } } },
        transferProofs: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 250,
    });
    return payments.filter(p => {
      if (p.order?.orderType !== 'LOCAL') return false;
      if (method === 'CASH') return p.method === 'CASH';
      if (method === 'TRANSFER') return p.method !== 'CASH' || p.transferAmount > 0 || p.transferProofs.length > 0;
      return true;
    });
  }

  async proofImage(proofId: string) {
    const proof = await this.prisma.transferProof.findUnique({ where: { id: proofId } });
    if (!proof) throw new NotFoundException('Comprobante no encontrado');
    return proof;
  }

  async reviewPayment(paymentId: string, action: 'CONFIRMED' | 'REJECTED', user: any, reason?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { diningTable: true } }, transferProofs: true },
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    const update = {
      status: action,
      confirmedBy: user.id,
      confirmedAt: action === 'CONFIRMED' ? new Date() : null,
    };
    const updated = await this.prisma.payment.update({ where: { id: paymentId }, data: update });
    await this.prisma.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: action, ...(action === 'CONFIRMED' ? { status: 'DELIVERED' } : {}) },
    });
    await this.prisma.transferProof.updateMany({
      where: { paymentId },
      data: {
        status: action,
        reviewedById: user.id,
        reviewedAt: new Date(),
        rejectionReason: action === 'REJECTED' ? reason || 'Rechazado por caja' : null,
      },
    });
    let table = payment.order.tableId ? await this.findTable(payment.order.tableId) : null;
    if (action === 'CONFIRMED') {
      if (table && table.balance === 0) {
        const closed = await this.prisma.diningTable.update({
          where: { id: table.id },
          data: { status: 'CLOSED', closedAt: new Date() },
          include: this.buildTableInclude(),
        });
        table = this.summarizeTable(closed);
        this.socketGateway.emitTableClosed(table);
      } else {
        this.socketGateway.emitPaymentValidated({ payment: updated, table });
      }
    } else {
      this.socketGateway.emitPaymentRejected(payment.order.waiterId, { payment: updated, table, reason });
    }
    return { payment: updated, table };
  }

  async closeTable(tableId: string, user: any) {
    const table = await this.findTable(tableId);
    if (table.kitchenStatus === 'ACTIVE') throw new BadRequestException('No puedes cerrar una mesa con cocina pendiente');
    if (table.balance > 0 || table.paymentStatus !== 'CONFIRMED') throw new BadRequestException('No puedes cerrar una mesa con pago pendiente');
    const closed = await this.prisma.diningTable.update({
      where: { id: tableId },
      data: { status: 'CLOSED', closedAt: new Date() },
      include: this.buildTableInclude(),
    });
    this.socketGateway.emitTableClosed(this.summarizeTable(closed));
    return this.summarizeTable(closed);
  }

  async purgeProofsForClosing(cashClosingId: string) {
    const proofs = await this.prisma.transferProof.findMany({ where: { cashClosingId, status: { not: 'PURGED' } } });
    for (const proof of proofs) {
      if (proof.filePath && existsSync(proof.filePath)) {
        await unlink(proof.filePath).catch(() => undefined);
      }
    }
    await this.prisma.transferProof.updateMany({
      where: { cashClosingId },
      data: { status: 'PURGED', filePath: null, purgedAt: new Date() },
    });
  }

  async assertNoOpenTableWork(cashRegisterId?: string) {
    const openTables = await this.prisma.diningTable.count({
      where: { status: 'OPEN', ...(cashRegisterId ? { cashRegisterId } : {}) },
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
