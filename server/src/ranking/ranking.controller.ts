import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RankingService } from './ranking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Ranking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ranking')
export class RankingController {
  constructor(private rankingService: RankingService) {}

  @Get('weekly')
  @ApiOperation({ summary: 'Ranking semanal de meseros' })
  getWeeklyRanking(@Request() req: any, @Query('weekStart') weekStart?: string) {
    return this.rankingService.getWeeklyRanking(weekStart, req.user.siteId);
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Ranking mensual de meseros' })
  getMonthlyRanking(@Request() req: any, @Query('month') month?: string) {
    return this.rankingService.getMonthlyRanking(month, req.user.siteId);
  }

  @Get('waiter/:userId')
  @ApiOperation({ summary: 'Estadísticas de un mesero' })
  getWaiterStats(@Param('userId') userId: string, @Request() req: any) {
    return this.rankingService.getWaiterStats(userId, req.user.siteId);
  }

  @Post('recalculate')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Recalcular métricas del día' })
  recalculateMetrics(@Request() req: any, @Body('date') date?: string) {
    return this.rankingService.recalculateMetrics(date, req.user.siteId);
  }

  @Post('award')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Otorgar insignias semanales' })
  awardBadges(@Request() req: any) {
    return this.rankingService.awardBadges(req.user.siteId);
  }

  @Get('badges')
  @ApiOperation({ summary: 'Listar todas las insignias' })
  getAllBadges() {
    return this.rankingService.getAllBadges();
  }

  @Post('badges')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear insignia' })
  createBadge(@Body() body: any) {
    return this.rankingService.createBadge(body);
  }

  @Put('badges/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar insignia' })
  updateBadge(@Param('id') id: string, @Body() body: any) {
    return this.rankingService.updateBadge(id, body);
  }
}
