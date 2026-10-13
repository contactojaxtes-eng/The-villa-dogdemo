import { ForbiddenException } from '@nestjs/common';
import { GlobalSiteManagerGuard } from './global-site-manager.guard';

describe('GlobalSiteManagerGuard', () => {
  const guard = new GlobalSiteManagerGuard();
  const contextFor = (user: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it.each(['SUPERADMIN', 'ADMIN_GENERAL'])(
    'allows the trusted global role %s',
    (globalRole) => {
      expect(guard.canActivate(contextFor({ role: 'ADMIN', globalRole }))).toBe(
        true,
      );
    },
  );

  it('rejects a site-scoped ADMIN', () => {
    expect(() =>
      guard.canActivate(contextFor({ role: 'ADMIN', globalRole: null })),
    ).toThrow(ForbiddenException);
  });

  it('does not trust the operational role alone', () => {
    expect(() =>
      guard.canActivate(contextFor({ role: 'SUPERADMIN', globalRole: null })),
    ).toThrow(ForbiddenException);
  });
});
