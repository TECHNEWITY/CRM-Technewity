import { Notification } from '@prisma/client'
import { notificationModel } from './_prisma'

export class NotificationRepository {
  async createNotification(data: {
    organizationId: string
    userId: string
    type: string
    title: string
    body?: string
    link?: string
  }) {
    return await notificationModel.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body || null,
        link: data.link || null,
        isRead: false,
        createdAt: new Date()
      }
    })
  }

  async getNotificationsByUser(userId: string, limit = 30) {
    return await notificationModel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit
    })
  }

  async getUnreadCountByUser(userId: string) {
    return await notificationModel.count({
      where: { userId, isRead: false }
    })
  }

  async markAsRead(id: string, userId: string) {
    return await notificationModel.updateMany({
      where: { id, userId },
      data: { isRead: true }
    })
  }

  async markAllAsRead(userId: string) {
    return await notificationModel.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    })
  }
}
