import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const contextFor = (user: any) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('uses explicit permissions for a custom role', () => {
    const reflector: any = {
      getAllAndOverride: jest.fn().mockReturnValue(['dispatch.change_status']),
    };
    const guard = new PermissionsGuard(reflector);
    expect(
      guard.canActivate(
        contextFor({
          role: 'CUSTOM_DISPATCH',
          permissions: ['dispatch.change_status'],
        }),
      ),
    ).toBe(true);
  });

  it('rejects a user without any required permission', () => {
    const reflector: any = {
      getAllAndOverride: jest.fn().mockReturnValue(['whatsapp.reply']),
    };
    const guard = new PermissionsGuard(reflector);
    expect(() =>
      guard.canActivate(
        contextFor({ role: 'DISPATCHER', permissions: ['dispatch.view'] }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects an ADMIN whose membership permissions are restricted and missing the required permission', () => {
    const reflector: any = {
      getAllAndOverride: jest.fn().mockReturnValue(['whatsapp.reply']),
    };
    const guard = new PermissionsGuard(reflector);
    // ADMIN con permisos restringidos únicamente a 'orders.view'
    expect(() =>
      guard.canActivate(
        contextFor({ role: 'ADMIN', permissions: ['orders.view'] }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows an ADMIN without restricted permissions (defaults to wildcard)', () => {
    const reflector: any = {
      getAllAndOverride: jest.fn().mockReturnValue(['whatsapp.reply']),
    };
    const guard = new PermissionsGuard(reflector);
    // ADMIN con permissions null/undefined hereda los permisos por defecto de ADMIN (['*'])
    expect(
      guard.canActivate(contextFor({ role: 'ADMIN', permissions: null })),
    ).toBe(true);
  });

  it('always allows SUPERADMIN unconditionally', () => {
    const reflector: any = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue(['some.restricted.permission']),
    };
    const guard = new PermissionsGuard(reflector);
    expect(
      guard.canActivate(contextFor({ role: 'SUPERADMIN', permissions: [] })),
    ).toBe(true);
  });
});
