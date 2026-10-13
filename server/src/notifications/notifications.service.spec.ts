import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

describe('NotificationsService multisite isolation', () => {
  const siteId = 'site-2';
  let prisma: any;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      userSiteMembership: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new NotificationsService(prisma);
  });

  it('lists and counts notifications only in the active site', async () => {
    await service.findAll('user-1', siteId);
    await service.getUnreadCount('user-1', siteId);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId, userId: 'user-1' } }),
    );
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { siteId, userId: 'user-1', read: false },
    });
  });

  it('cannot mark another site or another user notification as read', async () => {
    prisma.notification.findFirst.mockResolvedValue(null);

    await expect(service.markAsRead('notification-1', 'user-1', siteId))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('creates role notifications from active memberships in the selected site', async () => {
    prisma.userSiteMembership.findMany.mockResolvedValue([
      { userId: 'admin-2', user: { id: 'admin-2' } },
    ]);
    prisma.notification.create.mockResolvedValue({ id: 'notification-1' });

    await service.createForRole('ADMIN', 'Aviso', 'Mensaje', 'INFO', siteId);

    expect(prisma.userSiteMembership.findMany).toHaveBeenCalledWith({
      where: { siteId, role: 'ADMIN', active: true, user: { active: true } },
      include: { user: true },
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        siteId,
        userId: 'admin-2',
        title: 'Aviso',
        message: 'Mensaje',
        type: 'INFO',
      },
    });
  });
});
