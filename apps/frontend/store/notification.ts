import { create } from 'zustand'
import { Notification } from '@prisma/client'
import {
  notificationGetAll,
  notificationMarkAllRead,
  notificationMarkRead
} from '@/services/notification'

interface INotificationStore {
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
  notifications: Notification[]
  unreadCount: number
  isLoading: boolean
  loadNotifications: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  addNotification: (notif: Notification) => void
}

export const useNotificationStore = create<INotificationStore>((set, get) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  loadNotifications: async () => {
    try {
      set({ isLoading: true })
      const res = await notificationGetAll({ limit: 30 })
      const { notifications = [], unreadCount = 0 } = res.data?.data || {}
      set({ notifications, unreadCount, isLoading: false })
    } catch (error) {
      console.error('[Notification Store] Load error:', error)
      set({ isLoading: false })
    }
  },

  markAsRead: async (id: string) => {
    try {
      set((state) => ({
        notifications: state.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        unreadCount: Math.max(0, state.unreadCount - 1)
      }))
      await notificationMarkRead(id)
    } catch (error) {
      console.error('[Notification Store] Mark read error:', error)
    }
  },

  markAllAsRead: async () => {
    try {
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0
      }))
      await notificationMarkAllRead()
    } catch (error) {
      console.error('[Notification Store] Mark all read error:', error)
    }
  },

  addNotification: (notif: Notification) => {
    if (!notif) return
    set((state) => ({
      notifications: [notif, ...state.notifications],
      unreadCount: state.unreadCount + 1
    }))
  }
}))
