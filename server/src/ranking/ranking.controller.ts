import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
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
  getWeeklyRanking(@Query('weekStart') weekStart?: string) {
    return this.rankingService.getWeeklyRanking(weekStart);
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Ranking mensual de meseros' })
  getMonthlyRanking(@Query('month') month?: string) {
    return this.rankingService.getMonthlyRanking(month);
  }

  @Get('waiter/:userId')
  @ApiOperation({ summary: 'Estadísticas de un mesero' })
  getWaiterStats(@Param('userId') userId: string) {
    return this.rankingService.getWaiterStats(userId);
  }

  @Post('recalculate')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Recalcular métricas del día' })
  recalculateMetrics(@Body('date') date?: string) {
    return this.rankingService.recalculateMetrics(date);
  }

  @Post('award')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Otorgar insignias semanales' })
  awardBadges() {
    return this.rankingService.awardBadges();
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
