import { Controller, Get, Put, Post, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { AuthService } from '../auth/auth.service';
import { SuperadminService } from './superadmin.service';
import { TrafficService } from '../traffic/traffic.service';

@ApiTags('SuperAdmin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@Controller('superadmin')
export class SuperadminController {
  constructor(
    private superadminService: SuperadminService,
    private authService: AuthService,
    private trafficService: TrafficService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Panorama general del sistema (solo SuperAdmin)' })
  getOverview() {
    return this.superadminService.getOverview();
  }

  @Get('traffic')
  @ApiOperation({ summary: 'Tráfico HTTP agregado por ruta durante los últimos siete días UTC' })
  async getTraffic() {
    return {
      ...await this.trafficService.getLastSevenDays(),
      connections: this.superadminService.getConnectionCounts(),
    };
  }

  @Post('impersonate/:userId')
  @ApiOperation({ summary: 'Iniciar sesión de soporte como otro usuario' })
  impersonate(@Param('userId') userId: string, @Request() req: any) {
    return this.authService.impersonate(req.user, userId);
  }

  @Get('config/smtp')
  @ApiOperation({ summary: 'Ver configuración SMTP actual' })
  getSmtpConfig() {
    return this.superadminService.getSmtpSettings();
  }

  @Put('config/smtp')
  @ApiOperation({ summary: 'Actualizar configuración SMTP' })
  updateSmtpConfig(@Body() body: { host?: string; port?: number; user?: string; pass?: string; from?: string }) {
    return this.superadminService.updateSmtpSettings(body);
  }

  @Post('config/smtp/test')
  @ApiOperation({ summary: 'Enviar correo de prueba con la configuración SMTP actual' })
  sendTestEmail(@Body('to') to: string, @Request() req: any) {
    if (!to) throw new BadRequestException('Debes indicar un correo de destino');
    return this.superadminService.sendTestEmail(req.user, to);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Historial de auditoría' })
  getAuditLogs(@Query('page') page?: string, @Query('action') action?: string, @Query('actorId') actorId?: string) {
    return this.superadminService.getAuditLogs({ page: page ? Number(page) : undefined, action, actorId });
  }

  @Get('error-logs')
  @ApiOperation({ summary: 'Registro de errores del sistema' })
  getErrorLogs(@Query('page') page?: string) {
    return this.superadminService.getErrorLogs({ page: page ? Number(page) : undefined });
  }

  @Get('maintenance/db-size')
  @ApiOperation({ summary: 'Tamaño de la base de datos por tabla' })
  getDbSize() {
    return this.superadminService.getDbSize();
  }

  @Post('broadcast-refresh')
  @ApiOperation({ summary: 'Forzar refresco instantáneo de todos los clientes conectados' })
  broadcastRefresh(@Request() req: any) {
    return this.superadminService.broadcastRefresh(req.user);
  }

}
