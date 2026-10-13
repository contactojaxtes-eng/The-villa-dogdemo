import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@Injectable()
export class RankingService {
  constructor(private prisma: PrismaService) {}

  async getWeeklyRanking(weekStart?: string, siteId = DEFAULT_SITE_ID) {
    const start = weekStart ? new Date(weekStart) : this.getMondayOfCurrentWeek();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const memberships = await this.prisma.userSiteMembership.findMany({
      where: { siteId, role: 'DELIVERY_MANAGER', active: true, user: { active: true } },
      include: { user: { select: { id: true, name: true, photo: true } } },
    });
    const waiters = memberships.map((membership) => membership.user);

    const metrics = await this.prisma.waiterMetric.findMany({
      where: { siteId, date: { gte: start, lt: end } },
    });

    const ranking = waiters.map(waiter => {
      const waiterMetrics = metrics.filter(m => m.userId === waiter.id);
      return {
        userId: waiter.id,
        name: waiter.name,
        photo: waiter.photo,
        totalOrders: waiterMetrics.reduce((s, m) => s + m.totalOrders, 0),
        ordersDelivered: waiterMetrics.reduce((s, m) => s + m.ordersDelivered, 0),
        totalSales: waiterMetrics.reduce((s, m) => s + m.totalSales, 0),
        totalTips: waiterMetrics.reduce((s, m) => s + m.totalTips, 0),
        avgDeliveryTime: waiterMetrics.length > 0 ? Math.round(waiterMetrics.reduce((s, m) => s + m.avgDeliveryTime, 0) / waiterMetrics.length) : 0,
        avgRating: waiterMetrics.length > 0 ? parseFloat((waiterMetrics.reduce((s, m) => s + m.avgRating, 0) / waiterMetrics.length).toFixed(1)) : 0,
      };
    });

    ranking.sort((a, b) => b.totalSales - a.totalSales);
    return ranking.map((r, index) => ({ ...r, position: index + 1 }));
  }

  async getMonthlyRanking(month?: string, siteId = DEFAULT_SITE_ID) {
    const now = new Date();
    const start = month ? new Date(month + '-01') : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const memberships = await this.prisma.userSiteMembership.findMany({
      where: { siteId, role: 'DELIVERY_MANAGER', active: true, user: { active: true } },
      include: { user: { select: { id: true, name: true, photo: true } } },
    });
    const waiters = memberships.map((membership) => membership.user);

    const metrics = await this.prisma.waiterMetric.findMany({
      where: { siteId, date: { gte: start, lt: end } },
    });

    const ranking = waiters.map(waiter => {
      const waiterMetrics = metrics.filter(m => m.userId === waiter.id);
      return {
        userId: waiter.id,
        name: waiter.name,
        photo: waiter.photo,
        totalOrders: waiterMetrics.reduce((s, m) => s + m.totalOrders, 0),
        ordersDelivered: waiterMetrics.reduce((s, m) => s + m.ordersDelivered, 0),
        totalSales: waiterMetrics.reduce((s, m) => s + m.totalSales, 0),
        totalTips: waiterMetrics.reduce((s, m) => s + m.totalTips, 0),
        avgDeliveryTime: waiterMetrics.length > 0 ? Math.round(waiterMetrics.reduce((s, m) => s + m.avgDeliveryTime, 0) / waiterMetrics.length) : 0,
        avgRating: waiterMetrics.length > 0 ? parseFloat((waiterMetrics.reduce((s, m) => s + m.avgRating, 0) / waiterMetrics.length).toFixed(1)) : 0,
      };
    });

    ranking.sort((a, b) => b.totalSales - a.totalSales);
    return ranking.map((r, index) => ({ ...r, position: index + 1 }));
  }

  async getWaiterStats(userId: string, siteId = DEFAULT_SITE_ID) {
    const now = new Date();
    const weekStart = this.getMondayOfCurrentWeek();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const weeklyMetrics = await this.prisma.waiterMetric.findMany({
      where: { siteId, userId, date: { gte: weekStart, lt: now } },
    });

    const monthlyMetrics = await this.prisma.waiterMetric.findMany({
      where: { siteId, userId, date: { gte: monthStart, lt: now } },
    });

    const badges = await this.prisma.waiterBadge.findMany({
      where: { siteId, userId },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });

    return {
      weekly: {
        orders: weeklyMetrics.reduce((s, m) => s + m.totalOrders, 0),
        delivered: weeklyMetrics.reduce((s, m) => s + m.ordersDelivered, 0),
        sales: weeklyMetrics.reduce((s, m) => s + m.totalSales, 0),
        tips: weeklyMetrics.reduce((s, m) => s + m.totalTips, 0),
      },
      monthly: {
        orders: monthlyMetrics.reduce((s, m) => s + m.totalOrders, 0),
        delivered: monthlyMetrics.reduce((s, m) => s + m.ordersDelivered, 0),
        sales: monthlyMetrics.reduce((s, m) => s + m.totalSales, 0),
        tips: monthlyMetrics.reduce((s, m) => s + m.totalTips, 0),
      },
      badges: badges.map(b => ({ id: b.badge.id, name: b.badge.name, icon: b.badge.icon, earnedAt: b.earnedAt })),
    };
  }

  async recalculateMetrics(date?: string, siteId = DEFAULT_SITE_ID) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const memberships = await this.prisma.userSiteMembership.findMany({
      where: { siteId, role: 'DELIVERY_MANAGER', active: true, user: { active: true } },
      include: { user: true },
    });
    const waiters = memberships.map((membership) => membership.user);

    for (const waiter of waiters) {
      const orders = await this.prisma.order.findMany({
        where: { siteId, assignedTo: waiter.id, createdAt: { gte: targetDate, lt: nextDay } },
      });

      const totalOrders = orders.length;
      const ordersDelivered = orders.filter(o => o.status === 'DELIVERED').length;
      const totalSales = orders.filter(o => o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
      const totalTips = orders.filter(o => o.status === 'DELIVERED').reduce((s, o) => s + (o.tip || 0), 0);

      const deliveredOrders = orders.filter(o => o.status === 'DELIVERED');
      const avgDeliveryTime = deliveredOrders.length > 0
        ? Math.round(deliveredOrders.reduce((s, o) => s + (new Date(o.updatedAt).getTime() - new Date(o.createdAt).getTime()), 0) / deliveredOrders.length / 60000)
        : 0;

      const ratedOrders = orders.filter(o => o.rated && o.rating);
      const avgRating = ratedOrders.length > 0
        ? parseFloat((ratedOrders.reduce((s, o) => s + (o.rating || 0), 0) / ratedOrders.length).toFixed(1))
        : 0;

      await this.prisma.waiterMetric.upsert({
        where: { siteId_userId_date: { siteId, userId: waiter.id, date: targetDate } },
        update: { totalOrders, ordersDelivered, totalSales, totalTips, avgDeliveryTime, avgRating, ratingCount: ratedOrders.length },
        create: { siteId, userId: waiter.id, date: targetDate, totalOrders, ordersDelivered, totalSales, totalTips, avgDeliveryTime, avgRating, ratingCount: ratedOrders.length },
      });
    }

    return { success: true, date: targetDate, waitersProcessed: waiters.length };
  }

  async getAllBadges() {
    return this.prisma.badge.findMany({ where: { active: true }, orderBy: { pointsRequired: 'asc' } });
  }

  async createBadge(data: { name: string; description: string; icon: string; condition: string; pointsRequired: number }) {
    return this.prisma.badge.create({ data });
  }

  async updateBadge(id: string, data: { name?: string; description?: string; icon?: string; condition?: string; pointsRequired?: number; active?: boolean }) {
    return this.prisma.badge.update({ where: { id }, data });
  }

  async awardBadges(siteId = DEFAULT_SITE_ID) {
    const ranking = await this.getWeeklyRanking(undefined, siteId);
    const weekId = this.getWeekIdentifier(new Date());
    const badges = await this.prisma.badge.findMany({ where: { active: true } });
    const awarded: any[] = [];

    if (ranking.length > 0) {
      const topSales = ranking.reduce((best, r) => r.totalSales > best.totalSales ? r : best, ranking[0]);
      const topTips = ranking.reduce((best, r) => r.totalTips > best.totalTips ? r : best, ranking[0]);
      const topRating = ranking.filter(r => r.avgRating > 0).reduce((best, r) => r.avgRating > best.avgRating ? r : best, { ...ranking[0], avgRating: 0 });
      const fastest = ranking.filter(r => r.avgDeliveryTime > 0).reduce((best, r) => r.avgDeliveryTime < best.avgDeliveryTime ? r : best, { ...ranking[0], avgDeliveryTime: 99999 });

      for (const badge of badges) {
        if (badge.name.includes('Ventas') || badge.condition.includes('ventas')) {
          await this.giveBadge(topSales.userId, badge.id, weekId, siteId);
          awarded.push({ badge: badge.name, user: topSales.name });
        }
      }
    }

    return { awarded, week: weekId };
  }

  private async giveBadge(userId: string, badgeId: string, week: string, siteId: string) {
    const existing = await this.prisma.waiterBadge.findUnique({
      where: { siteId_userId_badgeId_week: { siteId, userId, badgeId, week } },
    });
    if (!existing) {
      await this.prisma.waiterBadge.create({ data: { siteId, userId, badgeId, week } });
    }
  }

  private getMondayOfCurrentWeek(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  private getWeekIdentifier(date: Date): string {
    const start = this.getMondayOfCurrentWeek();
    return start.toISOString().split('T')[0];
  }
}
