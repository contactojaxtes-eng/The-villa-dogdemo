import { Controller, Get, Put, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar notificaciones del usuario' })
  findAll(@Request() req: any) {
    return this.notificationsService.findAll(req.user.id, req.user.siteId);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Contar notificaciones no leídas' })
  getUnreadCount(@Request() req: any) {
    return this.notificationsService.getUnreadCount(req.user.id, req.user.siteId);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Marcar notificación como leída' })
  markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.notificationsService.markAsRead(id, req.user.id, req.user.siteId);
  }

  @Put('read-all')
  @ApiOperation({ summary: 'Marcar todas como leídas' })
  markAllAsRead(@Request() req: any) {
    return this.notificationsService.markAllAsRead(req.user.id, req.user.siteId);
  }
}
