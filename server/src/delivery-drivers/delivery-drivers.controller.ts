import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, UploadedFiles, UseInterceptors, Res } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DeliveryDriversService } from './delivery-drivers.service';
import { CompleteDriverDeliveryDto, ConfigureDriverAccessDto, CreateDriverDto, UpdateDriverDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import * as express from 'express';

@ApiTags('Delivery Drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery-drivers')
export class DeliveryDriversController {
  constructor(private readonly deliveryDriversService: DeliveryDriversService) {}

  @Post()
  @Permissions('drivers.manage')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Crear un nuevo domiciliario' })
  create(@Body() body: CreateDriverDto) {
    return this.deliveryDriversService.create(body);
  }

  @Get()
  @Permissions('drivers.view', 'dispatch.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Listar todos los domiciliarios' })
  findAll(
    @Query('activeOnly') activeOnly?: string,
    @Query('filterType') filterType?: string,
    @Query('cashClosingId') cashClosingId?: string,
    @Query('selectedDate') selectedDate?: string,
    @Request() req?: any,
  ) {
    const active = activeOnly === 'true';
    const includePortalAccount = ['ADMIN', 'SUPERADMIN'].includes(req?.user?.role);
    return this.deliveryDriversService.findAll(active, filterType || 'CURRENT', cashClosingId, selectedDate, includePortalAccount);
  }

  @Post('merge-duplicates')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Unificar manualmente domiciliarios duplicados conservando el de más entregas' })
  async mergeDuplicates() {
    await this.deliveryDriversService.autoMergeDuplicates();
    return { success: true, message: 'Domiciliarios duplicados unificados exitosamente.' };
  }

  @Get('settlements/pending')
  @Permissions('dispatch.view', 'cash.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Efectivo pendiente por entregar de los domiciliarios' })
  getPendingSettlements() {
    return this.deliveryDriversService.getPendingSettlements();
  }

  @Get('access/candidates')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Usuarios disponibles para vincular a un domiciliario' })
  getAccessCandidates() {
    return this.deliveryDriversService.getAccessCandidates();
  }

  @Get('me')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Portal privado del domiciliario autenticado' })
  getMyPortal(@Request() req: any) {
    return this.deliveryDriversService.getMyPortal(req.user.id);
  }

  @Get('me/orders/:orderId/snapshot')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Sincronizar únicamente un pedido del portal del domiciliario' })
  getMyOrderSnapshot(
    @Param('orderId') orderId: string,
    @Request() req: any,
  ) {
    return this.deliveryDriversService.getMyOrderSnapshot(req.user.id, orderId);
  }

  @Get('me/orders/:orderId/chat')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Consultar el chat de un pedido propio sin modificarlo' })
  getMyOrderChat(
    @Param('orderId') orderId: string,
    @Query('before') before: string | undefined,
    @Query('beforeId') beforeId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: any,
  ) {
    return this.deliveryDriversService.getMyOrderChat(
      req.user.id,
      orderId,
      before,
      limit ? Number.parseInt(limit, 10) : undefined,
      beforeId,
    );
  }

  @Get('me/orders/:orderId/chat/messages/:messageId/media')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Abrir multimedia de un mensaje vinculado a un pedido propio' })
  async getMyOrderChatMedia(
    @Param('orderId') orderId: string,
    @Param('messageId') messageId: string,
    @Request() req: any,
    @Res() res: express.Response,
  ) {
    const media = await this.deliveryDriversService.getMyOrderChatMedia(req.user.id, orderId, messageId);
    return this.sendPrivateFile(res, media);
  }

  @Get('me/orders/:orderId/proofs/:proofId/image')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Abrir un comprobante vinculado a un pedido propio' })
  async getMyOrderProofImage(
    @Param('orderId') orderId: string,
    @Param('proofId') proofId: string,
    @Request() req: any,
    @Res() res: express.Response,
  ) {
    const proof = await this.deliveryDriversService.getMyOrderProofImage(req.user.id, orderId, proofId);
    return this.sendPrivateFile(res, proof);
  }

  private sendPrivateFile(
    res: express.Response,
    file: { buffer: Buffer; contentType: string },
  ) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', file.contentType);
    if (file.contentType === 'application/octet-stream') {
      res.setHeader('Content-Disposition', 'attachment');
    }
    res.setHeader('Content-Length', String(file.buffer.length));
    return res.end(file.buffer);
  }

  @Post('me/orders/:orderId/complete')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @UseInterceptors(AnyFilesInterceptor({
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 5,
      fieldSize: 2 * 1024 * 1024,
    },
  }))
  @ApiOperation({ summary: 'Marcar como entregado un pedido propio y registrar el cobro final' })
  completeMyOrder(
    @Param('orderId') orderId: string,
    @Body() body: CompleteDriverDeliveryDto,
    @Request() req: any,
    @UploadedFiles() files?: any[],
  ) {
    return this.deliveryDriversService.completeMyOrder(req.user.id, orderId, body, files);
  }

  @Post('me/orders/:orderId/proof')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @UseInterceptors(AnyFilesInterceptor({
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 5,
      fieldSize: 2 * 1024 * 1024,
    },
  }))
  @ApiOperation({ summary: 'Adjuntar o reemplazar el comprobante de un pedido propio ya entregado' })
  uploadMyProof(
    @Param('orderId') orderId: string,
    @Body() body: CompleteDriverDeliveryDto,
    @Request() req: any,
    @UploadedFiles() files?: any[],
  ) {
    return this.deliveryDriversService.uploadMyProof(req.user.id, orderId, body, files);
  }

  @Put('me/orders/:orderId/payment')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Corregir el método de pago de una entrega propia del turno actual' })
  updateMyPayment(
    @Param('orderId') orderId: string,
    @Body() body: CompleteDriverDeliveryDto,
    @Request() req: any,
  ) {
    return this.deliveryDriversService.updateMyPayment(req.user.id, orderId, body);
  }

  @Get(':id/access')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Consultar acceso individual de un domiciliario' })
  getAccess(@Param('id') id: string) {
    return this.deliveryDriversService.getAccess(id);
  }

  @Put(':id/access')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear o vincular acceso individual para un domiciliario' })
  configureAccess(@Param('id') id: string, @Body() body: ConfigureDriverAccessDto) {
    return this.deliveryDriversService.configureAccess(id, body);
  }

  @Post(':id/settlements')
  @Permissions('dispatch.change_status', 'cash.open_close')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Recibir y liquidar efectivo de un domiciliario' })
  settleCash(
    @Param('id') id: string,
    @Body() body: { orderIds: string[]; receivedCash: number; notes?: string },
    @Request() req: any,
  ) {
    return this.deliveryDriversService.settleCash(id, body, req.user.id);
  }

  @Get(':id/settlements')
  @Permissions('drivers.view', 'cash.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Historial de liquidaciones de un domiciliario' })
  getSettlements(@Param('id') id: string) {
    return this.deliveryDriversService.getSettlements(id);
  }

  @Get('queue')
  @Permissions('drivers.view', 'dispatch.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Obtener la cola de turnos y estado de pausas de los domiciliarios' })
  getQueue() {
    return this.deliveryDriversService.getQueueState();
  }

  @Post('queue/reorder')
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'DISPATCHER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reordenar la fila de turnos de domiciliarios' })
  reorderQueue(@Body() body: { queue: string[] }) {
    return this.deliveryDriversService.reorderQueue(body.queue);
  }

  @Post(':id/break')
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'DISPATCHER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Asignar tiempo de cena / descanso a un domiciliario' })
  startBreak(@Param('id') id: string, @Body() body: { minutes?: number }) {
    return this.deliveryDriversService.startDriverBreak(id, body?.minutes || 15);
  }

  @Post(':id/break/end')
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'DISPATCHER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Finalizar descanso de un domiciliario y reincorporarlo al final de la fila' })
  endBreak(@Param('id') id: string) {
    return this.deliveryDriversService.endDriverBreak(id);
  }

  @Get(':id')
  @Permissions('drivers.view', 'dispatch.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Obtener un domiciliario por ID con sus pedidos' })
  findOne(
    @Param('id') id: string,
    @Query('filterType') filterType?: string,
    @Query('cashClosingId') cashClosingId?: string,
    @Query('selectedDate') selectedDate?: string,
  ) {
    return this.deliveryDriversService.findOne(id, filterType, cashClosingId, selectedDate);
  }

  @Put(':id')
  @Permissions('drivers.manage')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Actualizar un domiciliario' })
  update(@Param('id') id: string, @Body() body: UpdateDriverDto) {
    return this.deliveryDriversService.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar (desactivar) un domiciliario' })
  remove(@Param('id') id: string) {
    return this.deliveryDriversService.remove(id);
  }
}
