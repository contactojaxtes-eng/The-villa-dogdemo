import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';

describe('UsersController draft-site setup', () => {
  let usersService: any;
  let auditService: any;
  let controller: UsersController;

  beforeEach(() => {
    usersService = {
      assertValidRole: jest.fn(async (role?: string) =>
        String(role || 'CASHIER').trim().toUpperCase(),
      ),
      create: jest.fn().mockResolvedValue({
        id: 'user-2',
        name: 'Caja sede 2',
        email: 'caja.sede2@thevilladog.local',
        role: 'CASHIER',
      }),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    auditService = { log: jest.fn() };
    controller = new UsersController(
      usersService,
      auditService,
      { sendPasswordChangedNotice: jest.fn() } as any,
    );
  });

  it('creates a regular user only in the active draft-site context', async () => {
    const body = {
      name: 'Caja sede 2',
      email: 'caja.sede2',
      password: '1234',
      role: 'cashier',
    };

    await controller.create(body, {
      user: {
        id: 'superadmin-1',
        name: 'Super Admin',
        role: 'SUPERADMIN',
        siteId: 'site-2',
        preparationMode: true,
      },
    });

    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CASHIER' }),
      'site-2',
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_CREATE', targetId: 'user-2' }),
    );
  });

  it('normalizes and rejects a Super Admin role in preparation mode', async () => {
    await expect(
      controller.create(
        {
          name: 'Otro superadmin',
          email: 'otro.admin',
          password: '1234',
          role: 'superadmin',
        },
        {
          user: {
            id: 'superadmin-1',
            name: 'Super Admin',
            role: 'SUPERADMIN',
            siteId: 'site-2',
            preparationMode: true,
          },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.create).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('does not allow a site administrator to set the organization scope', async () => {
    await expect(
      controller.create(
        {
          name: 'Escalado',
          email: 'escalado',
          password: '1234',
          role: 'ADMIN',
          isOrganizationAdmin: true,
        },
        { user: { id: 'site-admin', role: 'ADMIN', siteId: 'site-2' } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('does not let a site administrator edit a global administrator account', async () => {
    usersService.findOne.mockResolvedValue({
      id: 'global-admin',
      role: 'ADMIN',
      isOrganizationAdmin: true,
    });

    await expect(
      controller.update(
        'global-admin',
        { name: 'Cambio' },
        { user: { id: 'site-admin', role: 'ADMIN', globalRole: null, siteId: 'site-2' } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.update).not.toHaveBeenCalled();
  });
});
