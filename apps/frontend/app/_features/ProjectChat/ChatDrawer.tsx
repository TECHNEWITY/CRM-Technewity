import { useEffect } from 'react'
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

  // Pusher real-time updates for chat messages in this project
  useEventProjectChat(projectId, (newMsg) => {
    handleIncomingMessage(newMsg)
  })

  // Load messages when drawer opens or projectId changes
  useEffect(() => {
    if (isOpen && projectId) {
      loadMessages(projectId)
    }
  }, [isOpen, projectId, loadMessages])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm transition-opacity"
        onClick={() => setIsOpen(false)}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white dark:bg-gray-900 shadow-2xl flex flex-col border-l border-gray-200 dark:border-gray-800">
          {/* Header */}
          <div className="px-4 py-3.5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm ring-2 ring-indigo-200 dark:ring-indigo-800">
                <HiSparkles className="w-4 h-4 text-yellow-300" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                  Project Chat & AI Bot
                </h3>
                <p className="text-[11px] text-gray-500">Real-time collaboration + @bot task creation</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
    </div>
  )
}
