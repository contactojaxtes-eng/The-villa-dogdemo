import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const SETTING_PREFIX = 'http_traffic_v1:';
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ROUTES_PER_DAY = 200;

type RouteTotals = {
  route: string;
  method: string;
  requests: number;
  bytes: number;
  unknownBytesRequests: number;
  errors: number;
};

type DayTotals = {
  date: string;
  firstSeenAt: string;
  lastSeenAt: string;
  requests: number;
  bytes: number;
  unknownBytesRequests: number;
  errors: number;
  routes: RouteTotals[];
};

/** Only route templates defined by this server are allowed into the metric label. */
export function trafficRouteLabel(path: string, routePath?: unknown): string {
  if (path === '/socket.io' || path.startsWith('/socket.io/')) return '/socket.io/*';
  if (path === '/api/whatsapp/media' || path.startsWith('/api/whatsapp/media/')) return '/api/whatsapp/media/*';
  if (path === '/assets' || path.startsWith('/assets/')) {
    if (/\.js$/i.test(path)) return '/assets/*.js';
    if (/\.css$/i.test(path)) return '/assets/*.css';
    return '/assets/*';
  }
  if (path === '/images' || path.startsWith('/images/')) return '/images/*';
  if (path === '/downloads' || path.startsWith('/downloads/')) {
    if (/\.exe$/i.test(path)) return '/downloads/*.exe';
    if (/\.zip$/i.test(path)) return '/downloads/*.zip';
    return '/downloads/*';
  }
  if (/^\/(?:TheVillaDogBridge|Instalar-Impresion-TheVillaDog)\.exe$/i.test(path)) return '/downloads/*.exe';
  if (/^\/TheVillaDog-Puente-Portable\.zip$/i.test(path)) return '/downloads/*.zip';
  if (path === '/') return '/';
  if (path === '/favicon.ico') return '/favicon.ico';
  if (typeof routePath !== 'string' || !path.startsWith('/api/') || routePath.length > 240) {
    return path.startsWith('/api/') ? '/api/other' : '/other';
  }
  const template = routePath.startsWith('/api/') ? routePath : `/api/${routePath.replace(/^\/+/, '')}`;
  const segments = template.split('/').slice(1);
  if (segments.length > 10) return '/api/other';
  const safe = segments.map(segment => {
    if (segment.startsWith(':') || segment.startsWith('*')) return ':id';
    if (!/^[a-z][a-z0-9-]{0,48}$/i.test(segment)) return null;
    return segment.toLowerCase();
  });
  return safe.some(segment => segment === null) ? '/api/other' : '/' + safe.join('/');
}

export function responseBodyLength(method: string, statusCode: number, contentLength: unknown): number | null {
  if (method === 'HEAD' || statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode < 200)) return 0;
  if (typeof contentLength !== 'string' && typeof contentLength !== 'number') return null;
  const value = Number(contentLength);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function emptyDay(date: string, now: string): DayTotals {
  return { date, firstSeenAt: now, lastSeenAt: now, requests: 0, bytes: 0, unknownBytesRequests: 0, errors: 0, routes: [] };
}

function isDayTotals(value: unknown): value is DayTotals {
  if (!value || typeof value !== 'object') return false;
  const day = value as DayTotals;
  return /^\d{4}-\d{2}-\d{2}$/.test(day.date)
    && typeof day.firstSeenAt === 'string' && typeof day.lastSeenAt === 'string'
    && Number.isSafeInteger(day.requests) && Number.isSafeInteger(day.bytes)
    && Number.isSafeInteger(day.unknownBytesRequests) && Number.isSafeInteger(day.errors)
    && Array.isArray(day.routes) && day.routes.length <= MAX_ROUTES_PER_DAY + 1
    && day.routes.every(route => typeof route.route === 'string' && typeof route.method === 'string'
      && Number.isSafeInteger(route.requests) && Number.isSafeInteger(route.bytes)
      && Number.isSafeInteger(route.unknownBytesRequests) && Number.isSafeInteger(route.errors));
}

@Injectable()
export class TrafficService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrafficService.name);
  private readonly instanceId = randomUUID();
  private readonly days = new Map<string, DayTotals>();
  private readonly dirty = new Set<string>();
  private flushTimer?: ReturnType<typeof setInterval>;
  private flushInProgress?: Promise<void>;
  private lastPrunedDate?: string;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.flushTimer = setInterval(() => void this.flush().catch(() => this.logger.warn('No se pudo guardar la medición HTTP; se reintentará.')), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush().catch(() => this.logger.warn('No se pudo guardar la última medición HTTP.'));
  }

  observe(req: Request, res: Response) {
    // The dashboard itself should not alter the totals while it is being inspected.
    if (req.path === '/api/superadmin/traffic') return;

    // Compression removes Content-Length immediately before sending the headers.
    // Keep that declared logical size so measurements remain comparable with
    // snapshots collected before HTTP compression was enabled.
    let logicalContentLength: unknown;
    const originalRemoveHeader = res.removeHeader;
    if (typeof originalRemoveHeader === 'function') {
      res.removeHeader = function removeHeader(name: string) {
        if (name.toLowerCase() === 'content-length' && this.getHeader('content-encoding')) {
          logicalContentLength = this.getHeader('content-length');
        }
        return originalRemoveHeader.call(this, name);
      };
    }

    res.once('finish', () => {
      const now = new Date().toISOString();
      const date = now.slice(0, 10);
      const route = trafficRouteLabel(req.path, req.route?.path);
      const method = /^[A-Z]{1,10}$/.test(req.method) ? req.method : 'OTHER';
      const length = responseBodyLength(method, res.statusCode, res.getHeader('content-length') ?? logicalContentLength);
      const isError = res.statusCode >= 500;
      let day = this.days.get(date);
      if (!day) {
        day = emptyDay(date, now);
        this.days.set(date, day);
      }
      day.lastSeenAt = now;
      day.requests++;
      day.bytes += length ?? 0;
      day.unknownBytesRequests += Number(length === null);
      day.errors += Number(isError);
      let totals = day.routes.find(item => item.route === route && item.method === method);
      if (!totals) {
        totals = { route: day.routes.length < MAX_ROUTES_PER_DAY ? route : '/other', method: day.routes.length < MAX_ROUTES_PER_DAY ? method : 'OTHER', requests: 0, bytes: 0, unknownBytesRequests: 0, errors: 0 };
        const existingOverflow = day.routes.find(item => item.route === totals!.route && item.method === totals!.method);
        if (existingOverflow) totals = existingOverflow;
        else day.routes.push(totals);
      }
      totals.requests++;
      totals.bytes += length ?? 0;
      totals.unknownBytesRequests += Number(length === null);
      totals.errors += Number(isError);
      this.dirty.add(date);
    });
  }

  private settingKey(date: string) {
    return `${SETTING_PREFIX}${this.instanceId}:${date}`;
  }

  private async flush() {
    if (this.flushInProgress) return this.flushInProgress;
    this.flushInProgress = this.flushDirtyDays();
    try { await this.flushInProgress; } finally { this.flushInProgress = undefined; }
  }

  private async flushDirtyDays() {
    for (const date of Array.from(this.dirty)) {
      const day = this.days.get(date);
      if (!day) { this.dirty.delete(date); continue; }
      const snapshot = JSON.stringify(day);
      try {
        await this.prisma.appSetting.upsert({
          where: { key: this.settingKey(date) },
          create: { key: this.settingKey(date), value: snapshot },
          update: { value: snapshot },
        });
        // Requests that arrived during the database write must be flushed again.
        if (JSON.stringify(day) === snapshot) this.dirty.delete(date);
      } catch {
        this.logger.warn('No se pudo guardar la medición HTTP; se reintentará.');
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastPrunedDate !== today) {
      try {
        await this.pruneOldDays(today);
        this.lastPrunedDate = today;
      } catch {
        this.logger.warn('No se pudieron limpiar mediciones HTTP antiguas.');
      }
    }
  }

  private async pruneOldDays(today: string) {
    const cutoff = new Date(`${today}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 13);
    const oldest = cutoff.toISOString().slice(0, 10);
    for (const date of this.days.keys()) {
      if (date < oldest) { this.days.delete(date); this.dirty.delete(date); }
    }
    const keys = await this.prisma.appSetting.findMany({
      where: { key: { startsWith: SETTING_PREFIX } }, select: { key: true },
    });
    const expired = keys.map(row => row.key).filter(key => /^http_traffic_v1:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/.test(key) && key.slice(-10) < oldest);
    if (expired.length) await this.prisma.appSetting.deleteMany({ where: { key: { in: expired } } });
  }

  async getLastSevenDays() {
    const today = new Date();
    const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6));
    const oldest = cutoff.toISOString().slice(0, 10);
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { startsWith: SETTING_PREFIX } }, select: { key: true, value: true },
    });
    const byDay = new Map<string, DayTotals>();
    for (const row of rows) {
      const match = /^http_traffic_v1:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/.exec(row.key);
      if (!match || match[2] < oldest || match[2] > today.toISOString().slice(0, 10)) continue;
      // In-memory data is newer than this instance's persisted snapshot.
      if (match[1] === this.instanceId && this.days.has(match[2])) continue;
      try {
        const parsed: unknown = JSON.parse(row.value);
        if (isDayTotals(parsed) && parsed.date === match[2]) this.mergeDay(byDay, parsed);
      } catch { /* Ignore a corrupt snapshot. */ }
    }
    for (const [date, day] of this.days) {
      if (date >= oldest && date <= today.toISOString().slice(0, 10)) this.mergeDay(byDay, day);
    }
    return {
      days: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)).map(day => ({
        ...day,
        routes: day.routes.sort((a, b) => b.bytes - a.bytes || b.requests - a.requests),
      })),
      note: 'Medición desde que se despliega esta versión: tamaño lógico de respuestas HTTP con Content-Length conocido, antes de compresión y sin cabeceras. Las respuestas sin longitud figuran como desconocidas; no incluye WebSocket, tráfico saliente hacia Meta/Gemini ni overhead del proxy Railway. Errores = respuestas HTTP 5xx. Fechas UTC.',
    };
  }

  private mergeDay(target: Map<string, DayTotals>, source: DayTotals) {
    let day = target.get(source.date);
    if (!day) {
      day = emptyDay(source.date, source.firstSeenAt);
      target.set(source.date, day);
    }
    if (source.firstSeenAt < day.firstSeenAt) day.firstSeenAt = source.firstSeenAt;
    if (source.lastSeenAt > day.lastSeenAt) day.lastSeenAt = source.lastSeenAt;
    day.requests += source.requests;
    day.bytes += source.bytes;
    day.unknownBytesRequests += source.unknownBytesRequests;
    day.errors += source.errors;
    for (const route of source.routes) {
      let aggregate = day.routes.find(item => item.route === route.route && item.method === route.method);
      if (!aggregate) {
        aggregate = { ...route };
        day.routes.push(aggregate);
      } else {
        aggregate.requests += route.requests;
        aggregate.bytes += route.bytes;
        aggregate.unknownBytesRequests += route.unknownBytesRequests;
        aggregate.errors += route.errors;
      }
    }
  }
}
