import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string, siteId = DEFAULT_SITE_ID) {
    return this.prisma.notification.findMany({
      where: { siteId, userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUnreadCount(userId: string, siteId = DEFAULT_SITE_ID) {
    return this.prisma.notification.count({ where: { siteId, userId, read: false } });
  }

  async markAsRead(id: string, userId: string, siteId = DEFAULT_SITE_ID) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, siteId, userId },
    });
    if (!notification) throw new NotFoundException('Notificación no encontrada');
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllAsRead(userId: string, siteId = DEFAULT_SITE_ID) {
    return this.prisma.notification.updateMany({
      where: { siteId, userId, read: false },
      data: { read: true },
    });
  }

  async create(
    data: { userId: string; title: string; message: string; type: string },
    siteId = DEFAULT_SITE_ID,
  ) {
    return this.prisma.notification.create({ data: { ...data, siteId } });
  }

  async createForRole(
    role: string,
    title: string,
    message: string,
    type: string,
    siteId = DEFAULT_SITE_ID,
  ) {
    const memberships = await this.prisma.userSiteMembership.findMany({
      where: { siteId, role, active: true, user: { active: true } },
      include: { user: true },
    });
    const notifications: any[] = [];
    for (const membership of memberships) {
      const notif = await this.prisma.notification.create({
        data: { siteId, userId: membership.userId, title, message, type },
      });
      notifications.push(notif);
    }
    return notifications;
  }
}
