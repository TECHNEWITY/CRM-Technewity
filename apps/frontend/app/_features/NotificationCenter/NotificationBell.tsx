import { useEffect, useState, useRef } from 'react'
import { useNotificationStore } from '@/store/notification'
import { HiBell, HiCheck, HiOutlineSparkles } from 'react-icons/hi2'
import { format } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { notifications, unreadCount, loadNotifications, markAsRead, markAllAsRead } =
    useNotificationStore()

  useEffect(() => {
    loadNotifications()
    // Poll every 30 seconds for background refresh
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [loadNotifications])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(ev.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleNotificationClick = async (notif: any) => {
    if (!notif.isRead) {
      await markAsRead(notif.id)
    }
    setIsOpen(false)
    if (notif.link) {
      router.push(notif.link)
    }
  }

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="Notifications"
      >
        <HiBell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-gray-900 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-800 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notifications</h4>
              {unreadCount > 0 && (
                <span className="text-[11px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-medium px-2 py-0.5 rounded-full">
                  {unreadCount} unread
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead()}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-medium"
              >
                <HiCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-xs">
                No notifications right now
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-3 text-left transition-colors cursor-pointer flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
                    !notif.isRead ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <HiOutlineSparkles className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                    )}
                    <span className="text-[10px] text-gray-400 mt-1 block">
                      {format(new Date(notif.createdAt), 'MMM d, h:mm a')}
                    </span>
                  </div>
                  {!notif.isRead && (
                    <span className="w-2 h-2 rounded-full bg-indigo-600 flex-shrink-0 mt-1.5" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
