import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CashRegistersService } from './cash-registers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';

@ApiTags('Cash Registers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cash-registers')
export class CashRegistersController {
  constructor(private cashRegistersService: CashRegistersService) {}

  @Get()
  @Permissions('cash.view')
  findAll() {
    return this.cashRegistersService.findAll();
  }

  @Get(':id/summary')
  @Permissions('cash.view')
  getSummary(@Param('id') id: string, @Query('date') date?: string) {
    return this.cashRegistersService.getSummary(id, date);
  }

  @Post()
  @Permissions('cash.control')
  create(@Body() body: { name: string; description?: string; managerId?: string; purpose?: string }) {
    return this.cashRegistersService.create(body);
  }

  @Put(':id')
  @Permissions('cash.control')
  update(@Param('id') id: string, @Body() body: any) {
    return this.cashRegistersService.update(id, body);
  }

  @Delete(':id')
  @Permissions('cash.control')
  remove(@Param('id') id: string) {
    return this.cashRegistersService.remove(id);
  }
}
