import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class PrintBridgeGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = process.env.PRINT_BRIDGE_TOKEN;
    if (!expected || expected.length < 32) throw new NotFoundException('Puente de impresión no configurado');
    const request = context.switchToHttp().getRequest();
    const supplied = String(request.headers['x-print-token'] || '');
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
