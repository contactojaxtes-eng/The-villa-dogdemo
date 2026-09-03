import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';
import { SocketGateway } from '../socket/socket.gateway';

const SMTP_SETTING_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];

@Injectable()
export class SuperadminService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private whatsappService: WhatsappService,
    private auditService: AuditService,
    private socketGateway: SocketGateway,
  ) {}

  async broadcastRefresh(actor: { id: string; name: string; role: string }) {
    const result = this.socketGateway.emitForceRefresh({
      triggeredBy: actor.id,
      triggeredByName: actor.name,
    });
    await this.auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'SYSTEM_FORCE_REFRESH',
      metadata: { clientsNotified: result.clientsNotified },
    });
    return { ok: true, ...result };
  }

  async getOverview() {
    const [usersByRole, ordersTotal, todayStart, errorLogsLast24h, whatsappSessionsActive, dbSize, smtpConfig, whatsappSettings] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true }, where: { active: true } }),
      this.prisma.order.count(),
      Promise.resolve(new Date(new Date().setHours(0, 0, 0, 0))),
      this.prisma.errorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      this.prisma.whatsAppSession.count({ where: { active: true } }),
      this.getDbSize(),
      this.mailService.getSmtpConfig(),
      this.whatsappService.getSettings(),
    ]);

    const ordersToday = await this.prisma.order.count({ where: { createdAt: { gte: todayStart } } });

    return {
      usersByRole: usersByRole.map(r => ({ role: r.role, count: r._count._all })),
      ordersToday,
      ordersTotal,
      errorLogsLast24h,
      whatsappSessionsActive,
      dbTotalSize: dbSize.total,
      smtpConfigured: !!(smtpConfig.host && smtpConfig.user && smtpConfig.pass),
      whatsappConfigured: whatsappSettings.configured,
    };
  }

  async getSmtpSettings() {
    const config = await this.mailService.getSmtpConfig();
    return {
      host: config.host,
      port: config.port,
      user: config.user,
      from: config.from,
      passConfigured: !!config.pass,
    };
  }

  async updateSmtpSettings(data: { host?: string; port?: number; user?: string; pass?: string; from?: string }) {
    const updates: { key: string; value: string }[] = [];
    if (data.host !== undefined) updates.push({ key: 'smtp_host', value: data.host.trim() });
    if (data.port !== undefined) updates.push({ key: 'smtp_port', value: String(data.port) });
    if (data.user !== undefined) updates.push({ key: 'smtp_user', value: data.user.trim() });
    if (data.from !== undefined) updates.push({ key: 'smtp_from', value: data.from.trim() });
    if (data.pass) updates.push({ key: 'smtp_pass', value: data.pass.replace(/\s+/g, '') });

    for (const u of updates) {
      await this.prisma.appSetting.upsert({ where: { key: u.key }, create: u, update: { value: u.value } });
    }
    await this.mailService.reloadTransporter();
    return this.getSmtpSettings();
  }

  async sendTestEmail(actor: { id: string; name: string; role: string }, to: string) {
    try {
      const result = await this.mailService.sendTestEmail(to.trim());
      await this.auditService.log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'SMTP_TEST_EMAIL',
        metadata: { to },
      });
      return result;
    } catch (err: any) {
      throw new BadRequestException(`Fallo al enviar correo: ${err.message || 'Credenciales o servidor rechazados'}`);
    }
  }

  async getAuditLogs(params: { page?: number; action?: string; actorId?: string }) {
    const page = Math.max(1, params.page || 1);
    const take = 50;
    const where: any = {};
    if (params.action) where.action = params.action;
    if (params.actorId) where.actorId = params.actorId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageCount: Math.ceil(total / take) };
  }

  async getErrorLogs(params: { page?: number }) {
    const page = Math.max(1, params.page || 1);
    const take = 50;
    const [items, total] = await Promise.all([
      this.prisma.errorLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take }),
      this.prisma.errorLog.count(),
    ]);
    return { items, total, page, pageCount: Math.ceil(total / take) };
  }

  async getDbSize() {
    const totalRows = await this.prisma.$queryRaw<{ size: string; bytes: bigint }[]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database()) AS bytes
    `;
    const tableRows = await this.prisma.$queryRaw<{ table_name: string; size: string; bytes: bigint }[]>`
      SELECT relname AS table_name, pg_size_pretty(pg_total_relation_size(relid)) AS size, pg_total_relation_size(relid) AS bytes
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `;
    return {
      total: totalRows[0]?.size || '0 bytes',
      tables: tableRows.map(t => ({ table: t.table_name, size: t.size })),
    };
  }

  async purgeOldWhatsappChats(actor: { id: string; name: string; role: string }, olderThanDays: number) {
    const days = Math.max(30, Math.floor(olderThanDays || 365));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const oldSessions = await this.prisma.whatsAppSession.findMany({
      where: { active: false, lastMessageAt: { lt: cutoff } },
      select: { id: true },
    });
    const sessionIds = oldSessions.map(s => s.id);

    if (sessionIds.length === 0) {
      return { sessionsDeleted: 0, messagesDeleted: 0 };
    }

    const { count: messagesDeleted } = await this.prisma.whatsAppMessage.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    const { count: sessionsDeleted } = await this.prisma.whatsAppSession.deleteMany({
      where: { id: { in: sessionIds } },
    });

    await this.auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'PURGE_WHATSAPP_CHATS',
      metadata: { olderThanDays: days, sessionsDeleted, messagesDeleted },
    });

    return { sessionsDeleted, messagesDeleted };
  }

  async resetTestSales(actor: { id: string; name: string; role: string }) {
    // 1. Comprobantes de transferencia y fotos de prueba
    const transferProofs = await this.prisma.transferProof.deleteMany();

    // 2. Comandas e ítems de cocina de prueba
    const ticketItems = await this.prisma.kitchenTicketItem.deleteMany();
    const tickets = await this.prisma.kitchenTicket.deleteMany();

    // 3. Pagos y registros vinculados a órdenes
    const payments = await this.prisma.payment.deleteMany();
    await this.prisma.stockMovement.deleteMany({ where: { orderId: { not: null } } });
    await this.prisma.orderChangeLog.deleteMany();
    const orderItems = await this.prisma.orderItem.deleteMany();

    // 4. Órdenes y pedidos
    const orders = await this.prisma.order.deleteMany();

    // 5. Mesas de salón de prueba (para abrir desde cero)
    const tables = await this.prisma.diningTable.deleteMany();

    // 6. Cierres de caja y turnos anteriores de prueba
    const closings = await this.prisma.cashClosing.deleteMany();

    // 7. Gastos, abonos y métricas de prueba
    const expenses = await this.prisma.expense.deleteMany();
    const customerPayments = await this.prisma.customerPayment.deleteMany();
    await this.prisma.waiterMetric.deleteMany();
    await this.prisma.printJob.deleteMany();
    await this.prisma.notification.deleteMany();

    // 8. Auditoría
    await this.auditService.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'RESET_TEST_SALES',
      metadata: {
        ordersDeleted: orders.count,
        orderItemsDeleted: orderItems.count,
        tablesDeleted: tables.count,
        ticketsDeleted: tickets.count,
        closingsDeleted: closings.count,
        paymentsDeleted: payments.count,
        transferProofsDeleted: transferProofs.count,
      },
    });

    // 9. Avisar por WebSockets en tiempo real a todas las pantallas abiertas
    try {
      this.socketGateway.server.emit('tableCreated');
      this.socketGateway.server.emit('tableClosed');
      this.socketGateway.server.emit('cashStatusChanged', { isOpen: false });
      this.socketGateway.server.emit('cashRegistersChanged');
      this.socketGateway.server.emit('ticketStatusChanged');
      this.socketGateway.emitForceRefresh({
        triggeredBy: actor.id,
        triggeredByName: actor.name,
      });
    } catch (e) {
      console.warn('WebSocket broadcast error on resetTestSales:', e);
    }

    return {
      success: true,
      message: 'Base de datos limpia y lista para operación real. Menú, productos, precios, usuarios y cajas registradoras preservados.',
      summary: {
        ordersDeleted: orders.count,
        orderItemsDeleted: orderItems.count,
        tablesDeleted: tables.count,
        ticketsDeleted: tickets.count,
        closingsDeleted: closings.count,
        paymentsDeleted: payments.count,
        transferProofsDeleted: transferProofs.count,
        expensesDeleted: expenses.count,
        customerPaymentsDeleted: customerPayments.count,
      },
    };
  }
}
