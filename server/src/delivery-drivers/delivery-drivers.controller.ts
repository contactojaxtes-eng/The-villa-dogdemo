import { Controller, Get, Post, Put, Delete, Body, Headers, Param, Query, UseGuards, Request, UploadedFiles, UseInterceptors, Res } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DeliveryDriversService } from './delivery-drivers.service';
import { CompleteDriverDeliveryDto, ConfigureDriverAccessDto, CreateDriverDto, UpdateDriverDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import * as express from 'express';
import { sendPrivateFileResponse } from '../common/private-file-response';

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
  create(@Body() body: CreateDriverDto, @Request() req: any) {
    return this.deliveryDriversService.create(body, req.user.siteId);
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
    return this.deliveryDriversService.findAll(active, filterType || 'CURRENT', cashClosingId, selectedDate, includePortalAccount, req.user.siteId);
  }

  @Post('merge-duplicates')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Unificar manualmente domiciliarios duplicados conservando el de más entregas' })
  async mergeDuplicates(@Request() req: any) {
    await this.deliveryDriversService.autoMergeDuplicates(req.user.siteId);
    return { success: true, message: 'Domiciliarios duplicados unificados exitosamente.' };
  }

  @Get('settlements/pending')
  @Permissions('dispatch.view', 'cash.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Efectivo pendiente por entregar de los domiciliarios' })
  getPendingSettlements(@Request() req: any) {
    return this.deliveryDriversService.getPendingSettlements(req.user.siteId);
  }

  @Get('access/candidates')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Usuarios disponibles para vincular a un domiciliario' })
  getAccessCandidates(@Request() req: any) {
    return this.deliveryDriversService.getAccessCandidates(req.user.siteId);
  }

  @Get('me')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Portal privado del domiciliario autenticado' })
  getMyPortal(@Request() req: any) {
    return this.deliveryDriversService.getMyPortal(req.user.id, req.user.siteId);
  }

  @Get('me/orders/:orderId/snapshot')
  @Roles('DELIVERY_DRIVER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Sincronizar únicamente un pedido del portal del domiciliario' })
  getMyOrderSnapshot(
    @Param('orderId') orderId: string,
    @Request() req: any,
  ) {
    return this.deliveryDriversService.getMyOrderSnapshot(req.user.id, orderId, req.user.siteId);
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
      req.user.siteId,
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
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const media = await this.deliveryDriversService.getMyOrderChatMedia(req.user.id, orderId, messageId, req.user.siteId);
    return this.sendPrivateFile(res, media, `driver-chat-media:${messageId}`, ifNoneMatch);
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
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const proof = await this.deliveryDriversService.getMyOrderProofImage(req.user.id, orderId, proofId, req.user.siteId);
    return this.sendPrivateFile(res, proof, `transfer-proof:${proofId}`, ifNoneMatch);
  }

  private sendPrivateFile(
    res: express.Response,
    file: { buffer: Buffer; contentType: string },
    resourceKey: string,
    ifNoneMatch?: string,
  ) {
    return sendPrivateFileResponse(res, {
      ...file,
      resourceKey,
      ifNoneMatch,
      attachment: file.contentType === 'application/octet-stream',
    });
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
    return this.deliveryDriversService.completeMyOrder(req.user.id, orderId, body, files, req.user.siteId);
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
    return this.deliveryDriversService.uploadMyProof(req.user.id, orderId, body, files, req.user.siteId);
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
    return this.deliveryDriversService.updateMyPayment(req.user.id, orderId, body, req.user.siteId);
  }

  @Get(':id/access')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Consultar acceso individual de un domiciliario' })
  getAccess(@Param('id') id: string, @Request() req: any) {
    return this.deliveryDriversService.getAccess(id, req.user.siteId);
  }

  @Put(':id/access')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear o vincular acceso individual para un domiciliario' })
  configureAccess(@Param('id') id: string, @Body() body: ConfigureDriverAccessDto, @Request() req: any) {
    return this.deliveryDriversService.configureAccess(id, body, req.user.siteId);
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
    return this.deliveryDriversService.settleCash(id, body, req.user.id, req.user.siteId);
  }

  @Get(':id/settlements')
  @Permissions('drivers.view', 'cash.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Historial de liquidaciones de un domiciliario' })
  getSettlements(@Param('id') id: string, @Request() req: any) {
    return this.deliveryDriversService.getSettlements(id, req.user.siteId);
  }

  @Get('queue')
  @Permissions('drivers.view', 'dispatch.view')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Obtener la cola de turnos y estado de pausas de los domiciliarios' })
  getQueue(@Request() req: any) {
    return this.deliveryDriversService.getQueueState(req.user.siteId);
  }

  @Post('queue/reorder')
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'DISPATCHER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Reordenar la fila de turnos de domiciliarios' })
  reorderQueue(@Body() body: { queue: string[] }, @Request() req: any) {
    return this.deliveryDriversService.reorderQueue(body.queue, req.user.siteId);
  }

  @Post(':id/break')
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'DISPATCHER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Asignar tiempo de cena / descanso a un domiciliario' })
  startBreak(@Param('id') id: string, @Body() body: { minutes?: number }, @Request() req: any) {
    return this.deliveryDriversService.startDriverBreak(id, body?.minutes || 15, req.user.siteId);
  }

  @Post(':id/break/end')
  @Roles('ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'DISPATCHER')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Finalizar descanso de un domiciliario y reincorporarlo al final de la fila' })
  endBreak(@Param('id') id: string, @Request() req: any) {
    return this.deliveryDriversService.endDriverBreak(id, req.user.siteId);
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
    @Request() req?: any,
  ) {
    return this.deliveryDriversService.findOne(id, filterType, cashClosingId, selectedDate, req.user.siteId);
  }

  @Put(':id')
  @Permissions('drivers.manage')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Actualizar un domiciliario' })
  update(@Param('id') id: string, @Body() body: UpdateDriverDto, @Request() req: any) {
    return this.deliveryDriversService.update(id, body, req.user.siteId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar (desactivar) un domiciliario' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.deliveryDriversService.remove(id, req.user.siteId);
  }
}
