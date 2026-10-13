import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CashRegistersService } from './cash-registers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';

@ApiTags('Cash Registers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cash-registers')
export class CashRegistersController {
  constructor(private cashRegistersService: CashRegistersService) {}

  @Get()
  @AllowDraftSiteSetup()
  @Permissions('cash.view')
  findAll(@Request() req: any) {
    return this.cashRegistersService.findAll(req.user.siteId);
  }

  @Get(':id/summary')
  @Permissions('cash.view')
  getSummary(@Param('id') id: string, @Query('date') date: string | undefined, @Request() req: any) {
    return this.cashRegistersService.getSummary(id, date, req.user.siteId);
  }

  @Post()
  @AllowDraftSiteSetup()
  @Permissions('cash.control')
  create(@Body() body: { name: string; description?: string; managerId?: string; purpose?: string }, @Request() req: any) {
    return this.cashRegistersService.create(body, req.user.siteId);
  }

  @Put(':id')
  @AllowDraftSiteSetup()
  @Permissions('cash.control')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.cashRegistersService.update(id, body, req.user.siteId);
  }

  @Delete(':id')
  @AllowDraftSiteSetup()
  @Permissions('cash.control')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.cashRegistersService.remove(id, req.user.siteId);
  }
}
