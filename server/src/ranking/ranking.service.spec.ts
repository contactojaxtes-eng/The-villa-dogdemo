import { RankingService } from './ranking.service';

describe('RankingService multisite isolation', () => {
  const siteId = 'site-2';
  let prisma: any;
  let service: RankingService;

  beforeEach(() => {
    prisma = {
      userSiteMembership: { findMany: jest.fn().mockResolvedValue([]) },
      waiterMetric: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      waiterBadge: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new RankingService(prisma);
  });

  it('builds the weekly ranking from local memberships and local metrics', async () => {
    await service.getWeeklyRanking(undefined, siteId);

    expect(prisma.userSiteMembership.findMany).toHaveBeenCalledWith({
      where: { siteId, role: 'DELIVERY_MANAGER', active: true, user: { active: true } },
      include: { user: { select: { id: true, name: true, photo: true } } },
    });
    expect(prisma.waiterMetric.findMany).toHaveBeenCalledWith({
      where: { siteId, date: expect.any(Object) },
    });
  });

  it('recalculates only orders assigned in the active site', async () => {
    prisma.userSiteMembership.findMany.mockResolvedValue([
      { user: { id: 'waiter-2' } },
    ]);

    await service.recalculateMetrics('2026-10-04', siteId);

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        siteId,
        assignedTo: 'waiter-2',
        createdAt: { gte: expect.any(Date), lt: expect.any(Date) },
      },
    });
    expect(prisma.waiterMetric.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          siteId_userId_date: {
            siteId,
            userId: 'waiter-2',
            date: expect.any(Date),
          },
        },
        create: expect.objectContaining({ siteId, userId: 'waiter-2' }),
      }),
    );
  });
});
