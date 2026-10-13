import { UnauthorizedException } from '@nestjs/common';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { createSitePrintBridgeToken, PrintBridgeGuard } from './print-bridge.guard';

describe('PrintBridgeGuard multisede', () => {
  const secret = 'principal-print-bridge-token-1234567890';
  const secondSiteId = '00000000-0000-4000-8000-000000000202';
  const previousToken = process.env.PRINT_BRIDGE_TOKEN;

  const contextFor = (token: string) => {
    const request: any = { headers: { 'x-print-token': token } };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => request }),
    };
    return { request, context };
  };

  beforeEach(() => {
    process.env.PRINT_BRIDGE_TOKEN = secret;
  });

  afterAll(() => {
    if (previousToken === undefined) delete process.env.PRINT_BRIDGE_TOKEN;
    else process.env.PRINT_BRIDGE_TOKEN = previousToken;
  });

  it('conserva la clave histórica restringida a la sede principal', () => {
    const { request, context } = contextFor(secret);

    expect(new PrintBridgeGuard().canActivate(context)).toBe(true);
    expect(request.printBridgeSiteId).toBe(DEFAULT_SITE_ID);
  });

  it('acepta una clave firmada y la liga únicamente a su sede', () => {
    const token = createSitePrintBridgeToken(secret, secondSiteId);
    const { request, context } = contextFor(token);

    expect(new PrintBridgeGuard().canActivate(context)).toBe(true);
    expect(request.printBridgeSiteId).toBe(secondSiteId);
  });

  it('rechaza una clave cuya sede fue alterada', () => {
    const token = createSitePrintBridgeToken(secret, secondSiteId)
      .replace(secondSiteId, DEFAULT_SITE_ID);
    const { context } = contextFor(token);

    expect(() => new PrintBridgeGuard().canActivate(context)).toThrow(UnauthorizedException);
  });
});
