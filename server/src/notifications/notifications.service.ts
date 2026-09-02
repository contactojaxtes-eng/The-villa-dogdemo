import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  async markAsRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async create(data: { userId: string; title: string; message: string; type: string }) {
    return this.prisma.notification.create({ data });
  }

  async createForRole(role: string, title: string, message: string, type: string) {
    const users = await this.prisma.user.findMany({ where: { role, active: true } });
    const notifications: any[] = [];
    for (const user of users) {
      const notif = await this.prisma.notification.create({
        data: { userId: user.id, title, message, type },
      });
      notifications.push(notif);
    }
    return notifications;
  }
}
