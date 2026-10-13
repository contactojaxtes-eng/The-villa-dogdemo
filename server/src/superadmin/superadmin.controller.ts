import { Controller, Get, Put, Post, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { GlobalSiteManagerGuard } from '../auth/guards/global-site-manager.guard';
import { AuthService } from '../auth/auth.service';
import { SuperadminService } from './superadmin.service';
import { TrafficService } from '../traffic/traffic.service';
import { SiteManagementService } from './site-management.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { UpdateSiteMemberDto } from './dto/update-site-member.dto';
import { UpsertSiteWhatsAppAccountDto } from './dto/upsert-site-whatsapp-account.dto';
import { ActivateSiteDto } from './dto/activate-site.dto';
import { DeactivateSiteDto } from './dto/deactivate-site.dto';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';

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
    private siteManagementService: SiteManagementService,
  ) {}

  @Get('sites')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(GlobalSiteManagerGuard)
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Listar sedes y su estado de preparación' })
  listSites() {
    return this.siteManagementService.list();
  }

  @Post('sites')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(GlobalSiteManagerGuard)
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Crear una sede inactiva para preparar su configuración' })
  createSite(@Body() body: CreateSiteDto, @Request() req: any) {
    return this.siteManagementService.createDraft(body, req.user);
  }

  @Put('sites/:siteId')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(GlobalSiteManagerGuard)
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Actualizar los datos generales de una sede' })
  updateSite(
    @Param('siteId') siteId: string,
    @Body() body: UpdateSiteDto,
    @Request() req: any,
  ) {
    return this.siteManagementService.updateMetadata(siteId, body, req.user);
  }

  @Get('sites/:siteId/members')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(GlobalSiteManagerGuard)
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Listar usuarios disponibles para una sede secundaria' })
  listSiteMembers(@Param('siteId') siteId: string) {
    return this.siteManagementService.listMembers(siteId);
  }

  @Put('sites/:siteId/members/:userId')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(GlobalSiteManagerGuard)
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Agregar o retirar un usuario de una sede secundaria' })
  updateSiteMember(
    @Param('siteId') siteId: string,
    @Param('userId') userId: string,
    @Body() body: UpdateSiteMemberDto,
    @Request() req: any,
  ) {
    return this.siteManagementService.updateMember(
      siteId,
      userId,
      body,
      req.user,
    );
  }

  @Put('sites/:siteId/whatsapp-account')
  @Roles('SUPERADMIN')
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Preparar el enrutamiento de WhatsApp de una sede' })
  upsertSiteWhatsAppAccount(
    @Param('siteId') siteId: string,
    @Body() body: UpsertSiteWhatsAppAccountDto,
    @Request() req: any,
  ) {
    return this.siteManagementService.upsertWhatsAppAccount(
      siteId,
      body,
      req.user,
    );
  }

  @Post('sites/:siteId/activate')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(GlobalSiteManagerGuard)
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Activar una sede preparada dentro de una ventana controlada' })
  activateSite(
    @Param('siteId') siteId: string,
    @Body() body: ActivateSiteDto,
    @Request() req: any,
  ) {
    return this.siteManagementService.activateSite(siteId, body, req.user);
  }

  @Post('sites/:siteId/deactivate')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(GlobalSiteManagerGuard)
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Pausar una sede secundaria sin borrar sus datos' })
  deactivateSite(
    @Param('siteId') siteId: string,
    @Body() body: DeactivateSiteDto,
    @Request() req: any,
  ) {
    return this.siteManagementService.deactivateSite(siteId, body, req.user);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Panorama general del sistema (solo SuperAdmin)' })
  getOverview(@Request() req: any) {
    return this.superadminService.getOverview(req.user?.siteId);
  }

  @Get('traffic')
  @ApiOperation({ summary: 'Tráfico HTTP de la sede activa por ruta durante los últimos siete días UTC' })
  async getTraffic(@Request() req: any) {
    return {
      ...await this.trafficService.getLastSevenDays(req.user.siteId),
      connections: this.superadminService.getConnectionCounts(req.user.siteId),
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
