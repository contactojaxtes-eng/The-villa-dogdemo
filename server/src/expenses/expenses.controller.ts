import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private expensesService: ExpensesService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Listar categorías de gastos' })
  findAllCategories() {
    return this.expensesService.findAllCategories();
  }

  @Post('categories')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Crear categoría de gasto' })
  createCategory(@Body() body: any) {
    return this.expensesService.createCategory(body);
  }

  @Put('categories/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar categoría de gasto' })
  updateCategory(@Param('id') id: string, @Body() body: any) {
    return this.expensesService.updateCategory(id, body);
  }

  @Get()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Listar todos los gastos' })
  findAll(@Query('categoryId') categoryId?: string, @Query('userId') userId?: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.expensesService.findAll({ categoryId, userId, startDate, endDate });
  }

  @Get('summary')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Resumen de gastos' })
  getSummary(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.expensesService.getSummary({ startDate, endDate });
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Obtener gasto por ID' })
  findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Registrar nuevo gasto' })
  create(@Body() body: any, @Request() req: any) {
    return this.expensesService.create({ ...body, userId: body.userId || req.user.id });
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Actualizar gasto' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.expensesService.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Eliminar gasto' })
  remove(@Param('id') id: string) {
    return this.expensesService.remove(id);
  }
}
