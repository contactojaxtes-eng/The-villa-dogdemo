import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req, Res, Request, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import * as express from 'express';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private whatsappService: WhatsappService) {}

  @Get('webhook')
  @ApiOperation({ summary: 'Verificación webhook Meta' })
  async verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: express.Response,
  ) {
    const result = await this.whatsappService.verifyWebhook(mode, token, challenge);
    if (result) {
      return res.status(200).send(result);
    }
    return res.status(403).send('Forbidden');
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Recibir mensajes WhatsApp' })
  handleWebhook(@Body() body: any) {
    return this.whatsappService.handleWebhook(body);
  }

  @Get('media/:mediaId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view', 'dispatch.view', 'orders.view')
  @ApiOperation({ summary: 'Proxy de archivos multimedia de WhatsApp Meta' })
  async streamMedia(@Param('mediaId') mediaId: string, @Res() res: express.Response) {
    return this.whatsappService.streamMedia(mediaId, res);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  async getSettings(@Request() req: any) {
    const settings = await this.whatsappService.getSettings();
    if (req.user.role !== 'SUPERADMIN' && settings.phoneId) {
      settings.phoneId = `••••${settings.phoneId.slice(-4)}`;
    }
    return settings;
  }

  @Get('order-reader-status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Estado de lectura automática para nuevo pedido' })
  getOrderReaderStatus() {
    return this.whatsappService.getOrderReaderStatus();
  }

  @Get('debug-pdf')
  async debugPdf() {
    const fs = require('fs');
    const path = require('path');
    const pathsToSearch = [
      path.join(process.cwd(), '20241224-niche-menu-full-1-1.pdf'),
      path.join(process.cwd(), 'server', '20241224-niche-menu-full-1-1.pdf'),
      path.join(__dirname, '..', '..', '..', '20241224-niche-menu-full-1-1.pdf'),
      path.join(__dirname, '..', '..', '20241224-niche-menu-full-1-1.pdf'),
      path.join(__dirname, '..', '20241224-niche-menu-full-1-1.pdf'),
      path.join(__dirname, '20241224-niche-menu-full-1-1.pdf'),
    ];

    const results = pathsToSearch.map(p => ({
      path: p,
      exists: fs.existsSync(p),
    }));

    return {
      cwd: process.cwd(),
      __dirname,
      results,
    };
  }

  @Get('debug-webhook')
  async debugWebhook() {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(process.cwd(), 'whatsapp-webhook-raw.json');
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e: any) {
        return { error: 'Failed to parse JSON', details: e.message };
      }
    }
    return { error: 'whatsapp-webhook-raw.json not found' };
  }

  @Get('debug-incoming')
  async debugIncoming() {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(process.cwd(), 'whatsapp-incoming-msg.json');
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return { error: 'whatsapp-incoming-msg.json not found' };
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  updateSettings(@Body() body: any, @Request() req: any) {
    if (req.user.role !== 'SUPERADMIN') {
      // Las credenciales core de Meta (WhatsApp Cloud API) solo las puede tocar el Super Admin
      const { phoneId, token, verifyToken, businessPhone, ...allowed } = body;
      return this.whatsappService.updateSettings(allowed);
    }
    return this.whatsappService.updateSettings(body);
  }

  @Post('settings/regenerate-menu-text')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  async regenerateMenuText() {
    const menuText = await this.whatsappService.regenerateMessagingMenuText();
    return { ok: true, menuText };
  }

  @Post('settings/payment-qr-file')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadPaymentQrFile(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Archivo no provisto');
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException('El QR debe ser una imagen JPG, PNG o WEBP');
    }
    const base64 = file.buffer.toString('base64');
    await this.whatsappService.savePaymentQrFile(base64, file.originalname, file.mimetype);
    return { ok: true, name: file.originalname, mimeType: file.mimetype };
  }

  @Delete('settings/payment-qr-file')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  async deletePaymentQrFile() {
    await this.whatsappService.deletePaymentQrFile();
    return { ok: true };
  }

  @Get('sessions/stats')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view')
  async getSessionsStats(@Req() req: any) {
    const userId = req.user?.id;
    return this.whatsappService.getSessionsStats(userId);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view')
  getSessions(
    @Query('search') search?: string,
    @Query('all') all?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('cursor') cursor?: string,
    @Query('pagination') pagination?: string,
    @Query('filter') filter?: string,
    @Req() req?: any
  ) {
    const userId = req?.user?.id;
    return this.whatsappService.getSessions(
      search,
      all === 'true',
      limit ? parseInt(limit, 10) : undefined,
      page ? parseInt(page, 10) : undefined,
      filter,
      userId,
      cursor,
      pagination === 'cursor',
    );
  }

  @Get('sessions/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view')
  async getSession(@Param('id') id: string) {
    const session = await this.whatsappService.getSession(id);
    if (!session) throw new BadRequestException('Sesión no encontrada');
    return session;
  }

  @Get('sessions/:id/messages')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view')
  async getSessionMessages(
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('beforeId') beforeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.whatsappService.getSessionMessages(
      id,
      before,
      limit ? parseInt(limit, 10) : undefined,
      beforeId,
    );
  }

  @Post('sessions/:id/read')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view')
  async markSessionAsRead(@Param('id') id: string) {
    await this.whatsappService.markSessionMessagesAsRead(id);
    return { success: true };
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  deleteSession(@Param('id') id: string) {
    return this.whatsappService.deleteSession(id);
  }

  @Put('sessions/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.reply')
  updateSession(
    @Param('id') id: string,
    @Body() body: { customerName?: string; customerPhone?: string }
  ) {
    return this.whatsappService.updateSession(id, body);
  }

  @Delete('messages/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  deleteMessage(@Param('id') id: string, @Query('mode') mode?: string) {
    return this.whatsappService.deleteMessage(id, mode);
  }

  @Put('messages/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.reply')
  editMessage(@Param('id') id: string, @Body() body: { content: string }) {
    return this.whatsappService.editMessage(id, body.content);
  }

  @Put('sessions/:id/assign')
  @UseGuards(JwtAuthGuard)
  assignSession(
    @Param('id') id: string,
    @Body('userId') userId: string | null,
    @Req() req: any,
  ) {
    return this.whatsappService.assignSession(id, userId, req.user);
  }

  @Post('sessions/unassign-all')
  @UseGuards(JwtAuthGuard)
  unassignAll(@Req() req: any) {
    const user = req.user;
    return this.whatsappService.unassignAllSessions(
      user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' ? undefined : user?.id
    );
  }

  @Post('send')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.reply')
  async sendMessage(@Body() body: { phone: string; text: string; replyToWaMessageId?: string; replyToContent?: string }) {
    const result = await this.whatsappService.sendMessage(body.phone, body.text, body.replyToWaMessageId, body.replyToContent);
    if (!result.sent) {
      const resAny = result as any;
      const errorMsg = resAny.error?.message 
        || (resAny.error?.code ? `Error de Meta (#${resAny.error.code}): ${resAny.error?.message || ''}` : null)
        || resAny.data?.error?.message 
        || resAny.reason 
        || 'Error al enviar mensaje de WhatsApp';
      throw new BadRequestException(errorMsg);
    }
    return result;
  }

  @Post('send-template')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.reply')
  async sendTemplate(
    @Body() body: { phone: string; templateName: string; languageCode?: string; params?: string[] }
  ) {
    const result = await this.whatsappService.sendTemplate(
      body.phone,
      body.templateName,
      body.languageCode || 'es',
      body.params || []
    );
    if (!result.sent) {
      const errorMsg = result.data?.error?.message || result.reason || 'Error al enviar plantilla de WhatsApp';
      throw new BadRequestException(errorMsg);
    }
    return result;
  }

  @Post('send-location')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.media')
  async sendLocation(
    @Body() body: { phone: string; latitude: number; longitude: number; name?: string; address?: string }
  ) {
    const result = await this.whatsappService.sendLocation(body.phone, body.latitude, body.longitude, body.name, body.address);
    if (!result.sent) {
      const errorMsg = result.data?.error?.message || result.reason || 'Error al enviar ubicación de WhatsApp';
      throw new BadRequestException(errorMsg);
    }
    return result;
  }

  @Post('send-media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.media')
  @UseInterceptors(FileInterceptor('file'))
  async sendMedia(
    @Body('phone') phone: string,
    @Body('type') type: 'image' | 'audio' | 'document' | 'video',
    @Body('caption') caption: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo no provisto');
    }
    const result = await this.whatsappService.sendMediaMessage(phone, file.buffer, file.originalname, file.mimetype, type, caption);
    if (!result.sent) {
      throw new BadRequestException(result.reason || 'Error al enviar multimedia');
    }
    return result;
  }

  @Post('send-menu')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.media', 'whatsapp.reply')
  async sendMenu(@Body('phone') phone: string) {
    if (!phone) {
      throw new BadRequestException('Teléfono no provisto');
    }
    const result: any = await this.whatsappService.sendMenuCarta(phone);
    if (!result.sent) {
      throw new BadRequestException(result.reason || result.error || 'Error al enviar la carta');
    }
    return result;
  }

  @Post('send-payment-qr')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.media', 'whatsapp.reply')
  async sendPaymentQr(@Body('phone') phone: string) {
    if (!phone) {
      throw new BadRequestException('Teléfono no provisto');
    }
    const result: any = await this.whatsappService.sendPaymentQr(phone);
    if (!result.sent) {
      throw new BadRequestException(result.reason || result.error || 'Error al enviar el QR de pago');
    }
    return result;
  }

  @Post('forward')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.media', 'whatsapp.reply')
  async forwardMessage(
    @Body('phone') phone: string,
    @Body('content') content: string,
    @Body('type') type?: string,
  ) {
    if (!phone || !content) {
      throw new BadRequestException('Teléfono y contenido requeridos para reenviar');
    }
    const result = await this.whatsappService.forwardMessage(phone, content, type);
    if (!result.sent) {
      throw new BadRequestException(result.reason || 'Error al reenviar mensaje');
    }
    return result;
  }

  @Post('test-meta')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Probar conexión y validez del token con Meta Cloud API' })
  async testMeta(@Body() body?: { token?: string; phoneId?: string }) {
    return this.whatsappService.testMetaConnection(body?.token, body?.phoneId);
  }

  @Post('test-gemini')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  async testGemini(@Body() body: { key?: string; prompt?: string; model?: string }) {
    return this.whatsappService.testGeminiConnection(body?.key, body?.prompt, body?.model);
  }

  @Post('gemini-models')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Consultar modelos y límites publicados por Gemini' })
  async getGeminiModels(@Body() body: { key?: string; model?: string }) {
    return this.whatsappService.getGeminiModelInfo(body?.key, body?.model);
  }

  @Post('parse-order')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.order_create')
  async parseOrder(@Body('text') text: string) {
    if (!text) {
      throw new BadRequestException('Texto del chat no provisto');
    }
    return this.whatsappService.parseOrderWithGemini(text);
  }

  @Get('order-chat/:orderId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view', 'dispatch.view', 'orders.view')
  @ApiOperation({ summary: 'Obtener el chat real de WhatsApp asociado a un pedido' })
  async getOrderChat(@Param('orderId') orderId: string) {
    return this.whatsappService.getOrderChat(orderId);
  }

  @Post('order-chat/:orderId/send')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.reply', 'dispatch.view', 'orders.view')
  @ApiOperation({ summary: 'Enviar mensaje de WhatsApp al cliente de un pedido' })
  async sendOrderChatMessage(
    @Param('orderId') orderId: string,
    @Body('text') text: string,
  ) {
    if (!text || !text.trim()) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }
    return this.whatsappService.sendOrderChatMessage(orderId, text.trim());
  }
}
