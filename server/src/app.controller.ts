import { ServiceUnavailableException, Controller, Get, Post, UseGuards, Body } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrintBridgeGuard } from './print/print-bridge.guard';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private prisma: PrismaService) {}

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
  async getPrintQueue() {
    const jobs = await this.prisma.printJob.findMany({
      where: { impreso: false },
      take: 100,
      orderBy: { id: 'asc' },
    });

    // La impresora consulta esta ruta cada pocos segundos. Si no hay trabajos,
    // evitamos leer también la configuración para mantener el sondeo liviano.
    if (jobs.length === 0) return [];

    let customPrinters: any[] = [];
    let cashPrinterIp = '';
    let cashPrinterPort = 9100;
    try {
      const rows = await this.prisma.appSetting.findMany({
        where: { key: { in: ['custom_prep_printers', 'caja_printer_ip', 'caja_printer_port'] } },
      });
      const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
      if (values.custom_prep_printers) {
        const parsed = JSON.parse(values.custom_prep_printers);
        customPrinters = Array.isArray(parsed) ? parsed : [];
      }
      cashPrinterIp = String(values.caja_printer_ip || '').trim();
      cashPrinterPort = Number(values.caja_printer_port) || 9100;
    } catch {}

    const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

    return jobs.map(j => {
      const storedTarget = (j.impresoraIp || '').trim();
      const targetKeys = new Set([normalize(storedTarget), normalize(j.tipo)]);
      let configuredPrinter = customPrinters.find(printer =>
        printer.enabled !== false && (targetKeys.has(normalize(printer.id)) || targetKeys.has(normalize(printer.name))),
      );
      if (!configuredPrinter) {
        const combinedTarget = [...targetKeys].join(' ');
        if (combinedTarget.includes('pizza')) {
          configuredPrinter = customPrinters.find(printer => printer.enabled !== false && normalize(printer.name).includes('pizza'));
        } else if (combinedTarget.includes('cocina')) {
          configuredPrinter = customPrinters.find(printer => printer.enabled !== false && normalize(printer.name).includes('cocina'));
        }
      }

      const isCashJob = normalize(j.tipo) === 'caja' || normalize(storedTarget) === 'caja';
      const resolvedIp = String(
        configuredPrinter?.ip || (isCashJob ? cashPrinterIp : '') || storedTarget,
      ).trim();
      const resolvedPort = Number(configuredPrinter?.port || (isCashJob ? cashPrinterPort : 0)) || 9100;
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
