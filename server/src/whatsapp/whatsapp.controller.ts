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

  @Post('settings/menu-file')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMenuFile(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Archivo no provisto');
    }
    const base64 = file.buffer.toString('base64');
    await this.whatsappService.saveMenuFile(base64, file.originalname, file.mimetype);
    return { ok: true, name: file.originalname, mimeType: file.mimetype };
  }

  @Delete('settings/menu-file')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  async deleteMenuFile() {
    await this.whatsappService.deleteMenuFile();
    return { ok: true };
  }

  @Post('settings/payment-qr-file')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPaymentQrFile(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Archivo no provisto');
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

  @Get('media/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.view')
  async getMedia(@Param('id') id: string, @Res() res: express.Response) {
    const media = await this.whatsappService.getMediaStream(id);
    if (!media) {
      res.status(404).send('Media not found');
      return;
    }
    res.setHeader('Content-Type', media.contentType);
    if (media.stream) {
      const stream = media.stream as any;
      if (typeof stream.pipe === 'function') {
        stream.pipe(res);
      } else if (stream[Symbol.asyncIterator]) {
        for await (const chunk of stream) {
          res.write(chunk);
        }
        res.end();
      } else {
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      }
    } else {
      res.status(404).send('Media stream is empty');
    }
  }

  @Put('sessions/:id/assign')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.assign')
  assignSession(
    @Param('id') id: string,
    @Body('userId') userId: string | null,
    @Req() req: any,
  ) {
    return this.whatsappService.assignSession(id, userId, req.user);
  }

  @Post('sessions/unassign-all')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('whatsapp.assign')
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
      const errorMsg = result.data?.error?.message || result.reason || 'Error al enviar mensaje de WhatsApp';
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

  @Post('test-gemini')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  async testGemini(@Body('key') key: string) {
    return this.whatsappService.testGeminiConnection(key);
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
}
