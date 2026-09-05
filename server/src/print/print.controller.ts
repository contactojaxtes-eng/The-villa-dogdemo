import { Controller, Get, Put, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrintService } from './print.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';

@ApiTags('Print')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('print')
export class PrintController {
  constructor(private printService: PrintService) {}

  @Get('settings')
  getSettings() {
    return this.printService.getPrinterSettings();
  }

  @Put('settings')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  saveSettings(@Body() body: any) {
    return this.printService.savePrinterSettings(body);
  }

  @Post('order/:orderId')
  @Permissions('orders.reprint', 'dispatch.change_status')
  @UseGuards(PermissionsGuard)
  printOrder(
    @Param('orderId') orderId: string,
    @Query('target') target?: string,
    @Query('kickDrawer') kickDrawer?: string
  ) {
    const shouldKick = kickDrawer === 'true';
    return this.printService.printOrder(orderId, target, shouldKick);
  }

  @Post('open-drawer')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  openDrawer() {
    return this.printService.openDrawer();
  }

  @Post('closing/:id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  printClosing(@Param('id') id: string) {
    return this.printService.printClosing(id);
  }

  @Post('opening/:id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @UseGuards(RolesGuard)
  printOpening(@Param('id') id: string) {
    return this.printService.printOpening(id);
  }

  @Post('test')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  async testPrint(@Query('target') target: string = 'cocina') {
    return this.printService.testPrint(target);
  }

  @Delete('queue')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  async clearPrintQueue() {
    return this.printService.clearPrintQueue();
  }

  @Delete('queue/:target')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  async clearPrintQueueByTarget(@Param('target') target: string) {
    return this.printService.clearPrintQueue(target);
  }
}
