import { UsersService } from './users.service';

describe('UsersService site isolation', () => {
  const principalSiteId = '00000000-0000-4000-8000-000000000101';
  const secondSiteId = 'site-2';
  let prisma: any;
  let socket: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      userSiteMembership: {
        update: jest.fn(),
        count: jest.fn(),
      },
    };
    socket = { emitToSite: jest.fn() };
    service = new UsersService(prisma, socket);
  });

  it('returns the role and active state from the requested site membership', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        name: 'Laura',
        email: 'laura@example.com',
        role: 'CASHIER',
        permissions: null,
        phone: null,
        photo: null,
        active: true,
        mustVerifyEmail: false,
        emailVerified: true,
        createdAt: new Date(),
        siteMemberships: [{ role: 'KITCHEN', permissions: ['kitchen.view'], active: true }],
      },
    ]);

    const result = await service.findAll({}, secondSiteId);

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { siteMemberships: { some: { siteId: secondSiteId } } },
        ]),
      }),
    }));
    expect(result).toEqual([expect.objectContaining({
      id: 'user-1',
      role: 'KITCHEN',
      permissions: ['kitchen.view'],
      active: true,
    })]);
  });

  it('updates a second-site role without changing the principal base role', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1', name: 'Laura', email: 'laura@example.com', role: 'CASHIER',
        permissions: null, phone: null, photo: null, active: true,
        mustVerifyEmail: false, emailVerified: true, createdAt: new Date(),
        siteMemberships: [{ role: 'CASHIER', permissions: null, active: true }],
      })
      .mockResolvedValueOnce({
        id: 'user-1', name: 'Laura', email: 'laura@example.com', role: 'CASHIER',
        permissions: null, phone: null, photo: null, active: true,
        mustVerifyEmail: false, emailVerified: true, createdAt: new Date(),
        siteMemberships: [{ role: 'KITCHEN', permissions: ['kitchen.view'], active: true }],
      });
    prisma.userSiteMembership.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});

    const result = await service.update('user-1', {
      role: 'KITCHEN',
      permissions: ['kitchen.view'],
    }, secondSiteId);

    expect(prisma.userSiteMembership.update).toHaveBeenCalledWith({
      where: { userId_siteId: { userId: 'user-1', siteId: secondSiteId } },
      data: { role: 'KITCHEN', permissions: ['kitchen.view'] },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {},
    });
    expect(result.role).toBe('KITCHEN');
    expect(socket.emitToSite).toHaveBeenCalledWith(secondSiteId, 'usersChanged');
  });

  it('keeps the account active when it is removed from only one of several sites', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', name: 'Laura', email: 'laura@example.com', role: 'CASHIER',
      permissions: null, phone: null, photo: null, active: true,
      mustVerifyEmail: false, emailVerified: true, createdAt: new Date(),
      siteMemberships: [{ role: 'CASHIER', permissions: null, active: true }],
    });
    prisma.userSiteMembership.update.mockResolvedValue({});
    prisma.userSiteMembership.count.mockResolvedValue(1);

    await service.remove('user-1', secondSiteId);

    expect(prisma.userSiteMembership.update).toHaveBeenCalledWith({
      where: { userId_siteId: { userId: 'user-1', siteId: secondSiteId } },
      data: { active: false },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(socket.emitToSite).toHaveBeenCalledWith(secondSiteId, 'usersChanged');
  });

  it('still mirrors principal-site role changes for legacy modules', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1', name: 'Laura', email: 'laura@example.com', role: 'CASHIER',
        permissions: null, phone: null, photo: null, active: true,
        mustVerifyEmail: false, emailVerified: true, createdAt: new Date(),
        siteMemberships: [{ role: 'CASHIER', permissions: null, active: true }],
      })
      .mockResolvedValueOnce({
        id: 'user-1', name: 'Laura', email: 'laura@example.com', role: 'KITCHEN',
        permissions: null, phone: null, photo: null, active: true,
        mustVerifyEmail: false, emailVerified: true, createdAt: new Date(),
        siteMemberships: [{ role: 'KITCHEN', permissions: null, active: true }],
      });
    prisma.userSiteMembership.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});

    await service.update('user-1', { role: 'KITCHEN' }, principalSiteId);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: 'KITCHEN' },
    });
  });
});
