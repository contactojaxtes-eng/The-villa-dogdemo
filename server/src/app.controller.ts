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

    let customPrinters: any[] = [];
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: 'custom_prep_printers' } });
      if (row?.value) customPrinters = JSON.parse(row.value);
    } catch {}

    const cocinaIp = customPrinters.find(p => p.name?.toLowerCase().includes('cocina') && p.ip)?.ip || '192.168.1.150';
    const pizzasIp = customPrinters.find(p => p.name?.toLowerCase().includes('pizza') && p.ip)?.ip || '192.168.1.140';

    return jobs.map(j => {
      let resolvedIp = (j.impresoraIp || '').trim();
      if (!/^\d+\.\d+\.\d+\.\d+/.test(resolvedIp) && !resolvedIp.startsWith('USB:')) {
        if (resolvedIp.toLowerCase().includes('pizza') || j.tipo?.toLowerCase().includes('pizza')) {
          resolvedIp = pizzasIp;
        } else {
          resolvedIp = cocinaIp;
        }
      }
      return {
        id: j.id,
        impresora_ip: resolvedIp,
        impresoraIp: resolvedIp,
        ip: resolvedIp,
        printer_ip: resolvedIp,
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
