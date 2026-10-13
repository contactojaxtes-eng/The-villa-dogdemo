import { Body, Controller, Get, Headers, Param, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { TablesService } from './tables.service';
import { detectReceiptMime } from './receipt';
import { sendPrivateFileResponse } from '../common/private-file-response';

@ApiTags('Payment Validation')
@ApiBearerAuth()
@Controller('payment-validation')
export class PaymentValidationController {
  constructor(private tablesService: TablesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Cola de pagos de mesas y domicilios por validar' })
  list(@Query('status') status: string | undefined, @Query('method') method: string | undefined, @Query('allHistory') allHistory: string | undefined, @Request() req: any) {
    return this.tablesService.listPaymentValidation(status || 'PENDING_REVIEW', method || 'ALL', allHistory === 'true', req.user.siteId);
  }

  @Get('proofs/:id/image')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Ver imagen temporal de comprobante' })
  async image(
    @Param('id') id: string,
    @Request() req: any,
    @Res() res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const proof = await this.tablesService.proofImage(id, req.user);
    if (proof.fileBase64) {
      let rawBase64 = proof.fileBase64.trim();
      if (rawBase64.startsWith('data:')) {
        const parts = rawBase64.split(',');
        rawBase64 = parts[1] || '';
      }
      try {
        const buffer = Buffer.from(rawBase64, 'base64');
        const mime = detectReceiptMime(buffer);
        if (buffer.length > 0 && mime) {
          return sendPrivateFileResponse(res, {
            buffer,
            contentType: mime,
            resourceKey: `transfer-proof:${proof.id}`,
            ifNoneMatch,
          });
        }
      } catch (err) {
        console.warn('[payment-validation] Error decodificando imagen base64:', err);
      }
    }
    if (proof.filePath && existsSync(proof.filePath)) {
      const buffer = readFileSync(proof.filePath);
      const mime = detectReceiptMime(buffer);
      if (mime) {
        return sendPrivateFileResponse(res, {
          buffer,
          contentType: mime,
          resourceKey: `transfer-proof:${proof.id}`,
          ifNoneMatch,
        });
      }
    }
    const isCash = proof.method === 'CASH';
    const placeholderSvg = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="100%" height="100%" fill="#0f172a" rx="20"/>
  <rect x="20" y="20" width="560" height="360" fill="none" stroke="#334155" stroke-width="2" stroke-dasharray="8 8" rx="16"/>
  <circle cx="300" cy="150" r="44" fill="${isCash ? '#10b981' : '#f59e0b'}" fill-opacity="0.15"/>
  <text x="300" y="166" fill="${isCash ? '#10b981' : '#f59e0b'}" font-family="system-ui, -apple-system, sans-serif" font-size="44" text-anchor="middle">${isCash ? '💵' : '🧾'}</text>
  <text x="300" y="235" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="800" text-anchor="middle">${isCash ? 'Cobro en Efectivo' : 'Comprobante de Transferencia'}</text>
  <text x="300" y="270" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="14" text-anchor="middle">${isCash ? 'Registrado por mesera · Validar dinero físico en caja' : 'Cobro registrado por mesera · Validado en caja'}</text>
</svg>`
    );
    return sendPrivateFileResponse(res, {
      buffer: placeholderSvg,
      contentType: 'image/svg+xml; charset=utf-8',
      resourceKey: `transfer-proof-placeholder:${proof.id}`,
      ifNoneMatch,
    });
  }

  @Put(':id/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Validar pago de mesa o domicilio' })
  validate(@Param('id') id: string, @Request() req: any) {
    return this.tablesService.reviewPayment(id, 'CONFIRMED', req.user);
  }

  @Put(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Rechazar pago de mesa o domicilio' })
  reject(@Param('id') id: string, @Body('reason') reason: string, @Request() req: any) {
    return this.tablesService.reviewPayment(id, 'REJECTED', req.user, reason);
  }
}
