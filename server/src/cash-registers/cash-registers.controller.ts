import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CashRegistersService } from './cash-registers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Cash Registers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
@Controller('cash-registers')
export class CashRegistersController {
  constructor(private cashRegistersService: CashRegistersService) {}

  @Get()
  findAll() {
    return this.cashRegistersService.findAll();
  }

  @Get(':id/summary')
  getSummary(@Param('id') id: string, @Query('date') date?: string) {
    return this.cashRegistersService.getSummary(id, date);
  }

  @Post()
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  create(@Body() body: { name: string; description?: string; managerId?: string }) {
    return this.cashRegistersService.create(body);
  }

  @Put(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  update(@Param('id') id: string, @Body() body: any) {
    return this.cashRegistersService.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  remove(@Param('id') id: string) {
    return this.cashRegistersService.remove(id);
  }
}
