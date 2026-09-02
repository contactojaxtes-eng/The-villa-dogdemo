import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @ApiOperation({ summary: 'Estadísticas del dashboard' })
  getDashboardStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.reportsService.getDashboardStats(startDate, endDate);
  }

  @Get('ai-insights')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @ApiOperation({ summary: 'Analítica predictiva e IA del restaurante' })
  getAiInsights() {
    return this.reportsService.getAiInsights();
  }

  @Post('ask-ai')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @ApiOperation({ summary: 'Consultar preguntas de negocio a la IA' })
  askAiQuestion(@Body('question') question: string) {
    return this.reportsService.askAiQuestion(question);
  }

  @Get('sales')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @ApiOperation({ summary: 'Reporte de ventas por período' })
  getSalesReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.reportsService.getSalesReport(startDate, endDate);
  }

  @Get('expenses')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @ApiOperation({ summary: 'Reporte de gastos por período' })
  getExpensesReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.reportsService.getExpensesReport(startDate, endDate);
  }

  @Get('daily')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @ApiOperation({ summary: 'Reporte diario' })
  getDailyReport(@Query('date') date: string) {
    return this.reportsService.getDailyReport(date || new Date().toISOString().split('T')[0]);
  }

  @Get('margins')
  @Roles('ADMIN', 'SUPERADMIN', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @ApiOperation({ summary: 'Reporte de márgenes y ganancias' })
  getMarginsReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.reportsService.getMarginsReport(startDate, endDate);
  }
}
