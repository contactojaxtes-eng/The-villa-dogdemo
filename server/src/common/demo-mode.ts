import { Logger } from '@nestjs/common';

const logger = new Logger('DemoGuard');

export function isDemoMode(): boolean {
  return (
    process.env.APP_ENV === 'demo' ||
    process.env.DEMO_MODE === 'true' ||
    process.env.ALLOW_EXTERNAL_SIDE_EFFECTS === 'false'
  );
}

export function logDemoBlockedAction(action: string, details?: any) {
  logger.warn(
    `[ACCION BLOQUEADA EN MODO DEMO] ${action} ${
      details ? JSON.stringify(details) : ''
    }`,
  );
}
