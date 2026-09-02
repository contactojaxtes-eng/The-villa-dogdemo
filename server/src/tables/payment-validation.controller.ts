import { Body, Controller, Get, Param, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { TablesService } from './tables.service';

@ApiTags('Payment Validation')
@ApiBearerAuth()
@Controller('payment-validation')
export class PaymentValidationController {
  constructor(private tablesService: TablesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Cola de pagos de mesas por validar' })
  list(@Query('status') status?: string, @Query('method') method?: string) {
    return this.tablesService.listPaymentValidation(status || 'PENDING_REVIEW', method || 'ALL');
  }

  @Get('proofs/:id/image')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Ver imagen temporal de comprobante' })
  async image(@Param('id') id: string, @Res() res: Response) {
    const proof = await this.tablesService.proofImage(id);
    res.setHeader('Content-Type', proof.mimeType || 'image/jpeg');
    res.sendFile(proof.filePath!);
  }

  @Put(':id/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Validar pago de mesa' })
  validate(@Param('id') id: string, @Request() req: any) {
    return this.tablesService.reviewPayment(id, 'CONFIRMED', req.user);
  }

  @Put(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Rechazar pago de mesa' })
  reject(@Param('id') id: string, @Body('reason') reason: string, @Request() req: any) {
    return this.tablesService.reviewPayment(id, 'REJECTED', req.user, reason);
  }
}
