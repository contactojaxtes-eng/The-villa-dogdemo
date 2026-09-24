import { ServiceUnavailableException, Controller, Get, Post, UseGuards, Body, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrintBridgeGuard } from './print/print-bridge.guard';
import { PrismaService } from './prisma/prisma.service';
import { PrintQueueSignalService } from './print/print-queue-signal.service';

const MAX_PRINT_QUEUE_WAIT_MS = 25_000;
const LEGACY_PRINT_QUEUE_WAIT_MS = 10_000;

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(
    private prisma: PrismaService,
    private printQueueSignal: PrintQueueSignalService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  getHello() {
    return {
      name: 'The Villa Dog Domicilios API',
      version: '1.0.0',
      status: 'running',
      docs: '/docs',
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Base de datos no disponible');
    }
  }

  @UseGuards(PrintBridgeGuard)
  @Get('imprimir/cola')
  @Get('cola-impresion')
  @Get('api/imprimir/cola')
  @Get('api/cola-impresion')
  @ApiOperation({ summary: 'Consultar cola de impresión' })
  async getPrintQueue(@Query('waitMs') waitMs?: string, @Req() request?: Request) {
    // El valor por defecto también alivia los puentes ya instalados, cuyo timeout
    // HTTP es 15 s. Un cliente puede usar waitMs=0 si requiere una lectura directa.
    const requestedWaitMs = waitMs === undefined ? LEGACY_PRINT_QUEUE_WAIT_MS : Number(waitMs);
    const boundedWaitMs = Number.isFinite(requestedWaitMs)
      ? Math.min(Math.max(Math.trunc(requestedWaitMs), 0), MAX_PRINT_QUEUE_WAIT_MS)
      : 0;
    const revision = this.printQueueSignal.currentRevision();
    let jobs = await this.prisma.printJob.findMany({
      where: { impreso: false },
      take: 100,
      orderBy: { id: 'asc' },
    });

    // Los puentes nuevos pueden mantener esta petición abierta. Si aparece un
    // trabajo, la señal local los despierta al instante; los puentes antiguos
    // usan la espera corta predeterminada, inferior a su timeout de 15 s.
    if (jobs.length === 0 && boundedWaitMs > 0) {
      const abortController = new AbortController();
      const abortWait = () => abortController.abort();
      if (request?.aborted) abortController.abort();
      else request?.once('aborted', abortWait);
      let changed = false;
      try {
        changed = await this.printQueueSignal.waitForChange(revision, boundedWaitMs, abortController.signal);
      } finally {
        request?.off('aborted', abortWait);
      }
      if (!changed) return [];
      jobs = await this.prisma.printJob.findMany({
        where: { impreso: false },
        take: 100,
        orderBy: { id: 'asc' },
      });
    }

    // Si no hay trabajos, evitamos leer también la configuración.
    if (jobs.length === 0) return [];

    let customPrinters: any[] = [];
    let cashPrinterIp = '';
    let cashPrinterPort = 9100;
    let cocinaPrinterIp = '';
    let cocinaPrinterPort = 9100;
    try {
      const rows = await this.prisma.appSetting.findMany({
        where: {
          key: {
            in: [
              'custom_prep_printers',
              'caja_printer_ip',
              'caja_printer_port',
              'cocina_printer_ip',
              'cocina_printer_port',
            ],
          },
        },
      });
      const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
      if (values.custom_prep_printers) {
        const parsed = JSON.parse(values.custom_prep_printers);
        customPrinters = Array.isArray(parsed) ? parsed : [];
      }
      cashPrinterIp = String(values.caja_printer_ip || '').trim();
      cashPrinterPort = Number(values.caja_printer_port) || 9100;
      cocinaPrinterIp = String(values.cocina_printer_ip || '').trim();
      cocinaPrinterPort = Number(values.cocina_printer_port) || 9100;
    } catch {}

    const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

    const isValidAddress = (addr: unknown): boolean => {
      const s = String(addr || '').trim();
      if (!s) return false;
      if (s.toUpperCase().startsWith('USB:')) {
        return s.slice(4).trim().length > 0;
      }
      const host = s.split(':')[0].trim();
      if (host.toLowerCase() === 'localhost') return true;
      const parts = host.split('.');
      return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
    };

    const validEnabledPrinters = customPrinters.filter(p => p && p.enabled !== false && isValidAddress(p.ip));
    const defaultDeliveryPrinter = validEnabledPrinters.find(p => p.channel === 'DELIVERY' || p.channel === 'BOTH') || validEnabledPrinters[0];

    // Deduplicar trabajos idénticos en la cola para que nunca salga doble la misma impresión
    const seenPayloads = new Set<string>();
    const duplicateIds: number[] = [];
    const uniqueJobs = jobs.filter(j => {
      const key = `${j.impresoraIp || ''}_${j.tipo}_${j.payload}`;
      if (seenPayloads.has(key)) {
        duplicateIds.push(j.id);
        return false;
      }
      seenPayloads.add(key);
      return true;
    });

    if (duplicateIds.length > 0) {
      this.prisma.printJob.deleteMany({
        where: { id: { in: duplicateIds } }
      }).catch(() => {});
    }

    return uniqueJobs.map(j => {
      const storedTarget = (j.impresoraIp || '').trim();
      const targetKeys = new Set([normalize(storedTarget), normalize(j.tipo)]);
      let configuredPrinter = customPrinters.find(printer =>
        printer.enabled !== false && (targetKeys.has(normalize(printer.id)) || targetKeys.has(normalize(printer.name))),
      );
      if (!configuredPrinter) {
        const combinedTarget = [...targetKeys].join(' ');
        if (combinedTarget.includes('pizza')) {
          configuredPrinter = customPrinters.find(printer => printer.enabled !== false && normalize(printer.name).includes('pizza'));
        } else if (combinedTarget.includes('cocina') || combinedTarget.includes('domicilio')) {
          configuredPrinter = customPrinters.find(printer => printer.enabled !== false && (normalize(printer.name).includes('cocina') || normalize(printer.name).includes('domicilio')));
        }
      }

      const isCashJob = normalize(j.tipo) === 'caja' || normalize(storedTarget) === 'caja';

      // 1. Preferir la IP configurada de la impresora encontrada
      let resolvedIp = isValidAddress(configuredPrinter?.ip) ? String(configuredPrinter.ip).trim() : '';
      let resolvedPort = Number(configuredPrinter?.port) || 9100;

      // 2. Si es de caja y tiene IP dedicada de caja válida
      if (!resolvedIp && isCashJob && isValidAddress(cashPrinterIp)) {
        resolvedIp = cashPrinterIp;
        resolvedPort = cashPrinterPort;
      }

      // 3. Si es comanda de preparación y hay una impresora activa configurada en Domicilios/Cocina
      if ((!resolvedIp || resolvedIp === '192.168.1.150') && defaultDeliveryPrinter && isValidAddress(defaultDeliveryPrinter.ip)) {
        resolvedIp = String(defaultDeliveryPrinter.ip).trim();
        resolvedPort = Number(defaultDeliveryPrinter.port) || 9100;
      }

      // 4. Si tiene IP dedicada clásica de cocina válida
      if (!resolvedIp && isValidAddress(cocinaPrinterIp)) {
        resolvedIp = cocinaPrinterIp;
        resolvedPort = cocinaPrinterPort;
      }

      // 5. Si el storedTarget ya es una IP o USB válido directamente
      if (!resolvedIp && isValidAddress(storedTarget)) {
        resolvedIp = storedTarget;
      }

      // 6. Último recurso: lo que vino en el trabajo
      if (!resolvedIp) {
        resolvedIp = storedTarget;
      }

      return {
        id: j.id,
        impresora_ip: resolvedIp,
        impresoraIp: resolvedIp,
        ip: resolvedIp,
        printer_ip: resolvedIp,
        port: resolvedPort,
        impresora_puerto: resolvedPort,
        payload: j.payload,
        data: j.payload,
        tipo: j.tipo,
      };
    });
  }

  @UseGuards(PrintBridgeGuard)
  @Post('imprimir/cola')
  @Post('cola-impresion')
  @Post('api/imprimir/cola')
  @Post('api/cola-impresion')
  @ApiOperation({ summary: 'Confirmar impresión y limpiar cola' })
  async confirmPrint(@Body() body: { ids: number[] }) {
    if (body && Array.isArray(body.ids) && body.ids.length > 0) {
      await this.prisma.printJob.deleteMany({
        where: { id: { in: body.ids } },
      });
    }
    return { ok: true };
  }


}
