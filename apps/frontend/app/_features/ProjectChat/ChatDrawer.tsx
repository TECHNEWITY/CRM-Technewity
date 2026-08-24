import { useCallback, useEffect } from 'react'
import { useChatStore } from '@/store/chat'
import { useUrl } from '@/hooks/useUrl'
import { useEventProjectChat } from '@/events/useEventProjectChat'
import ChatMessageList from './ChatMessageList'
import ChatMessageInput from './ChatMessageInput'
import { HiXMark, HiSparkles } from 'react-icons/hi2'

export default function ChatDrawer() {
  const { projectId } = useUrl()
  const { isOpen, setIsOpen, messages, isLoading, isSending, loadMessages, sendMessage, handleIncomingMessage } =
    useChatStore()

  // Stable callback for Pusher real-time updates
  const onIncoming = useCallback(
    (newMsg: any) => {
      handleIncomingMessage(newMsg)
    },
    [handleIncomingMessage]
  )

  useEventProjectChat(projectId, onIncoming)

  // Load messages when drawer opens or projectId changes
  useEffect(() => {
    if (isOpen && projectId) {
      loadMessages(projectId)
    }
  }, [isOpen, projectId, loadMessages])

  // Auto-poll if any message is in PENDING or PROCESSING state to guarantee zero-refresh UI updates
  useEffect(() => {
    if (!isOpen || !projectId) return

    const hasPending = messages.some(
      (m) => m.status === 'PENDING' || m.status === 'PROCESSING'
    )
    if (!hasPending) return

    const timer = setInterval(() => {
      loadMessages(projectId)
    }, 2000)

    return () => clearInterval(timer)
  }, [isOpen, projectId, messages, loadMessages])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs sm:backdrop-blur-sm transition-opacity"
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer Container: Full screen on mobile (<640px), sidebar drawer on desktop (>=640px) */}
      <div className="relative z-10 w-full h-full sm:h-auto sm:max-w-md md:max-w-lg bg-white dark:bg-gray-900 shadow-2xl flex flex-col sm:border-l border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs ring-2 ring-indigo-200 dark:ring-indigo-800 shrink-0">
              <HiSparkles className="w-4 h-4 text-yellow-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5 truncate">
                Project Chat & AI Bot
              </h3>
              <p className="text-[11px] text-gray-500 truncate">Real-time collaboration + @bot task creation</p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close Chat"
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
          >
            <HiXMark className="w-5 h-5" />
          </button>
        </div>

        {/* Message Stream */}
        <ChatMessageList messages={messages} isLoading={isLoading} />

        {/* Composer */}
        <ChatMessageInput
          projectId={projectId}
          onSendMessage={(content, fileIds, mentionUserIds) =>
            sendMessage(projectId, content, fileIds, mentionUserIds)
          }
          isSending={isSending}
        />
      </div>
    </div>
  )
}
