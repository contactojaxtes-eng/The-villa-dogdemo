import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

const SITE_TOKEN_VERSION = 'v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safelyEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSitePrintBridgeToken(secret: string, siteId: string) {
  const signature = createHmac('sha256', secret)
    .update(`print-bridge:${SITE_TOKEN_VERSION}:${siteId}`)
    .digest('base64url');
  return `${SITE_TOKEN_VERSION}.${siteId}.${signature}`;
}

@Injectable()
export class PrintBridgeGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = String(process.env.PRINT_BRIDGE_TOKEN || '').trim();
    if (!expected || expected.length < 32) throw new NotFoundException('Puente de impresión no configurado');
    const request = context.switchToHttp().getRequest();
    const supplied = String(request.headers['x-print-token'] || '');

    // Compatibilidad temporal: la clave histórica queda restringida a la sede
    // principal. Las nuevas instalaciones usan una clave firmada y ligada a
    // una sede concreta, derivada del mismo secreto del servidor.
    if (safelyEqual(expected, supplied)) {
      request.printBridgeSiteId = DEFAULT_SITE_ID;
      return true;
    }

    const [version, siteId, signature, ...extra] = supplied.split('.');
    if (version !== SITE_TOKEN_VERSION || extra.length > 0 || !UUID_PATTERN.test(siteId || '')) {
      throw new UnauthorizedException();
    }

    const expectedToken = createSitePrintBridgeToken(expected, siteId);
    if (!safelyEqual(expectedToken, supplied)) throw new UnauthorizedException();
    request.printBridgeSiteId = siteId;
    return true;
  }
}
