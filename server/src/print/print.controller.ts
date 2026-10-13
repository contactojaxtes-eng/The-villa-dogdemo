import { Controller, Get, Put, Post, Delete, Body, Param, Query, UseGuards, Header, NotFoundException, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrintService } from './print.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import { createSitePrintBridgeToken } from './print-bridge.guard';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';

@ApiTags('Print')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('print')
export class PrintController {
  constructor(private printService: PrintService) {}

  @Get('settings')
  @AllowDraftSiteSetup()
  getSettings(@Req() req: any) {
    return this.printService.getPrinterSettings(req.user.siteId);
  }

  /**
   * Returns a bridge credential for the administrator's active site.
   * The public installer never contains it; the admin UI uses this endpoint
   * to generate a one-click installer for another computer.
  */
  @Get('bridge-token')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @Header('Cache-Control', 'no-store')
  getBridgeToken(@Req() req: any) {
    const token = String(process.env.PRINT_BRIDGE_TOKEN || '').trim();
    if (token.length < 32) {
      throw new NotFoundException('PRINT_BRIDGE_TOKEN no está configurado en el servidor.');
    }
    const siteId = req.user.siteId || DEFAULT_SITE_ID;
    return {
      // Los instaladores existentes conservan la clave histórica de la sede
      // principal; las otras sedes reciben una credencial ligada a su cola.
      token: siteId === DEFAULT_SITE_ID ? token : createSitePrintBridgeToken(token, siteId),
    };
  }

  @Put('settings')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  saveSettings(@Body() body: any, @Req() req: any) {
    return this.printService.savePrinterSettings(body, req.user.siteId);
  }

  @Post('order/:orderId')
  @Permissions('orders.reprint', 'dispatch.change_status')
  @UseGuards(PermissionsGuard)
  printOrder(
    @Req() req: any,
    @Param('orderId') orderId: string,
    @Query('target') target?: string,
    @Query('kickDrawer') kickDrawer?: string,
  ) {
    const shouldKick = kickDrawer === 'true';
    return this.printService.printOrder(orderId, target, shouldKick, req.user.siteId);
  }

  @Post('open-drawer')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  openDrawer(@Req() req: any) {
    return this.printService.openDrawer(req.user.siteId);
  }

  @Post('closing/:id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  printClosing(@Param('id') id: string, @Req() req: any) {
    return this.printService.printClosing(id, req.user.siteId);
  }

  @Post('opening/:id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  printOpening(@Param('id') id: string, @Req() req: any) {
    return this.printService.printOpening(id, req.user.siteId);
  }

  @Post('test')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  async testPrint(@Query('target') target: string = 'cocina', @Req() req: any) {
    return this.printService.testPrint(target, req.user.siteId);
  }

  @Delete('queue')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  async clearPrintQueue(@Req() req: any) {
    return this.printService.clearPrintQueue(undefined, req.user.siteId);
  }

  @Delete('queue/:target')
  @AllowDraftSiteSetup()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  async clearPrintQueueByTarget(@Param('target') target: string, @Req() req: any) {
    return this.printService.clearPrintQueue(target, req.user.siteId);
  }
}
