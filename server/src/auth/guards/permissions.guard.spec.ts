import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const contextFor = (user: any) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any);

  it('uses explicit permissions for a custom role', () => {
    const reflector: any = { getAllAndOverride: jest.fn().mockReturnValue(['dispatch.change_status']) };
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(contextFor({ role: 'CUSTOM_DISPATCH', permissions: ['dispatch.change_status'] }))).toBe(true);
  });

  it('rejects a user without any required permission', () => {
    const reflector: any = { getAllAndOverride: jest.fn().mockReturnValue(['whatsapp.reply']) };
    const guard = new PermissionsGuard(reflector);
    expect(() => guard.canActivate(contextFor({ role: 'DISPATCHER', permissions: ['dispatch.view'] })))
      .toThrow(ForbiddenException);
  });
});
