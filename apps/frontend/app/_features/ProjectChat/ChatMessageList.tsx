import { useEffect, useRef } from 'react'
import { ChatMessage } from '@prisma/client'
import ChatMessageItem from './ChatMessageItem'
import { Loading } from '@ui-components'

export default function ChatMessageList({
  messages,
  isLoading
}: {
  messages: ChatMessage[]
  isLoading: boolean
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loading title="Loading conversation..." />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-gray-500 dark:text-gray-400">
        <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-3">
          💬
        </div>
        <h4 className="font-medium text-gray-800 dark:text-gray-200">No messages yet</h4>
        <p className="text-xs mt-1 max-w-xs">
          Start collaborating! Mention <span className="font-semibold text-indigo-600">@bot</span> with <span className="font-semibold">/Task</span> or <span className="font-semibold">/Bug</span> to create tasks automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((msg) => (
        <ChatMessageItem key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
