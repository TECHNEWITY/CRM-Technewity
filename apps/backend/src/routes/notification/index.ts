import { Router } from 'express'
import { authMiddleware } from '../../middlewares'
import { AuthRequest } from '../../types'
import { NotificationRepository } from '@database'

const router = Router()
const notifRepo = new NotificationRepository()

// GET /api/notifications
router.get('/notifications', [authMiddleware], async (req: AuthRequest, res) => {
  const { id: userId } = req.authen
  const { limit = 30 } = req.query as { limit?: string | number }

  try {
    const parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : limit
    const notifications = await notifRepo.getNotificationsByUser(userId, parsedLimit || 30)
    const unreadCount = await notifRepo.getUnreadCountByUser(userId)

    return res.json({
      status: 200,
      data: {
        notifications,
        unreadCount
      }
    })
  } catch (error) {
    console.error('[Notification API Error]', error)
    return res.status(500).json({ status: 500, error })
  }
})

// PATCH /api/notifications/:id/read
router.patch('/notifications/:id/read', [authMiddleware], async (req: AuthRequest, res) => {
  const { id: userId } = req.authen
  const { id } = req.params

  try {
    await notifRepo.markAsRead(id, userId)
    return res.json({ status: 200, data: { success: true } })
  } catch (error) {
    console.error('[Notification API Mark Read Error]', error)
    return res.status(500).json({ status: 500, error })
  }
})

// PATCH /api/notifications/read-all
router.patch('/notifications/read-all', [authMiddleware], async (req: AuthRequest, res) => {
  const { id: userId } = req.authen

  try {
    await notifRepo.markAllAsRead(userId)
    return res.json({ status: 200, data: { success: true } })
  } catch (error) {
    console.error('[Notification API Mark All Read Error]', error)
    return res.status(500).json({ status: 500, error })
  }
})

export default router
