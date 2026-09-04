import { Body, Controller, Get, Param, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
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
    if (proof.fileBase64) {
      let mime = proof.mimeType || 'image/jpeg';
      let rawBase64 = proof.fileBase64.trim();
      if (rawBase64.startsWith('data:')) {
        const parts = rawBase64.split(',');
        mime = parts[0].split(';')[0].replace('data:', '') || mime;
        rawBase64 = parts[1] || '';
      }
      try {
        const buffer = Buffer.from(rawBase64, 'base64');
        if (buffer.length > 0) {
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Length', buffer.length);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.end(buffer);
        }
      } catch (err) {
        console.warn('[payment-validation] Error decodificando imagen base64:', err);
      }
    }
    if (proof.filePath && existsSync(proof.filePath)) {
      res.setHeader('Content-Type', proof.mimeType || 'image/jpeg');
      return createReadStream(proof.filePath).pipe(res);
    }
    const placeholderSvg = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="100%" height="100%" fill="#0f172a" rx="20"/>
  <rect x="20" y="20" width="560" height="360" fill="none" stroke="#334155" stroke-width="2" stroke-dasharray="8 8" rx="16"/>
  <circle cx="300" cy="150" r="44" fill="#f59e0b" fill-opacity="0.15"/>
  <text x="300" y="166" fill="#f59e0b" font-family="system-ui, -apple-system, sans-serif" font-size="44" text-anchor="middle">🧾</text>
  <text x="300" y="235" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="800" text-anchor="middle">Comprobante de Transferencia</text>
  <text x="300" y="270" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="14" text-anchor="middle">Cobro registrado por mesera · Validado en caja</text>
</svg>`
    );
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Length', placeholderSvg.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(placeholderSvg);
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
