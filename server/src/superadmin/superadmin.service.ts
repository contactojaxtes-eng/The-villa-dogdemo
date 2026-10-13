import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';
import { SocketGateway } from '../socket/socket.gateway';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

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

  getConnectionCounts(siteId?: string) {
    return this.socketGateway.getConnectionCounts(siteId);
  }

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

  async getOverview(siteId = DEFAULT_SITE_ID) {
    const resolvedSiteId = String(siteId || DEFAULT_SITE_ID).trim() || DEFAULT_SITE_ID;
    const [usersByRole, ordersTotal, todayStart, errorLogsLast24h, whatsappSessionsActive, dbSize, smtpConfig, whatsappSettings] = await Promise.all([
      // Operational users are memberships of the selected site. Reading the
      // global User.role here would mix users from every site in the tenant.
      this.prisma.userSiteMembership.groupBy({
        by: ['role'],
        _count: { _all: true },
        where: { siteId: resolvedSiteId, active: true, user: { active: true } },
      }),
      this.prisma.order.count({ where: { siteId: resolvedSiteId } }),
      Promise.resolve(new Date(new Date().setHours(0, 0, 0, 0))),
      // ErrorLog predates multisite and has no siteId. Keep this server-wide
      // health signal explicit until error records are migrated safely.
      this.prisma.errorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      this.prisma.whatsAppSession.count({ where: { siteId: resolvedSiteId, active: true } }),
      this.getDbSize(),
      this.mailService.getSmtpConfig(),
      this.whatsappService.getSettings(resolvedSiteId),
    ]);

    const ordersToday = await this.prisma.order.count({ where: { siteId: resolvedSiteId, createdAt: { gte: todayStart } } });

    return {
      siteId: resolvedSiteId,
      usersByRole: usersByRole.map(r => ({ role: r.role, count: r._count._all })),
      ordersToday,
      ordersTotal,
      errorLogsLast24h,
      errorLogsScope: 'global',
      whatsappSessionsActive,
      dbTotalSize: dbSize.total,
      dbScope: 'global',
      smtpConfigured: !!(smtpConfig.host && smtpConfig.user && smtpConfig.pass),
      smtpScope: 'global',
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

}
