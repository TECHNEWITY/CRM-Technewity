'use client'
import { useEffect, useState } from 'react'

import MemberAvatar from '@/components/MemberAvatar'
import { useMemberStore } from '@/store/member'
import { format } from 'date-fns'
import { HiArrowTopRightOnSquare, HiSparkles } from 'react-icons/hi2'
import { useUrl } from '@/hooks/useUrl'
import { useGetParams } from '@/hooks/useGetParams'
import { useRouter } from 'next/navigation'

// Local type mirrors the Prisma ChatMessage model.
// Using a local type avoids dependency on the stale Prisma generated client
// until `prisma generate` runs successfully.
interface ChatMessageRecord {
  id: string
  organizationId: string
  projectId: string
  senderId: string
  content: string
  mentionUserIds: string[]
  fileIds: string[]
  commandType?: string | null
  status: string
  linkedTaskId?: string | null
  errorMessage?: string | null
  isBotReply: boolean
  createdAt: Date | string | null
  updatedAt?: Date | string | null
}

export default function ChatMessageItem({ message }: { message: ChatMessageRecord }) {
  const { members } = useMemberStore()
  const { orgName } = useGetParams()
  const { projectId } = useUrl()
  const router = useRouter()

  // UserMember is User & { role }, so direct properties like id, name, email
  const sender = members.find((m) => m.id === message.senderId)
  const isBot = message.isBotReply || (sender as any)?.isBot

  const handleOpenTask = (taskId: string) => {
    router.push(`/${orgName}/project/${projectId}?mode=task&taskId=${taskId}`)
  }

  // Progressive thinking state timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (message.status !== 'PENDING' && message.status !== 'PROCESSING') {
      return
    }

    const createdTime = message.createdAt ? new Date(message.createdAt).getTime() : Date.now()
    const initialElapsed = Math.max(0, Math.floor((Date.now() - createdTime) / 1000))
    setElapsedSeconds(initialElapsed)

    const interval = setInterval(() => {
      const currentElapsed = Math.max(0, Math.floor((Date.now() - createdTime) / 1000))
      setElapsedSeconds(currentElapsed)
    }, 1000)

    return () => clearInterval(interval)
  }, [message.status, message.createdAt])

  return (
    <div
      className={`flex gap-3 text-sm group ${
        isBot
          ? 'bg-indigo-50/40 dark:bg-indigo-950/20 -mx-4 px-4 py-3 border-y border-indigo-100 dark:border-indigo-900/40'
          : 'py-2'
      }`}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 mt-0.5">
        {isBot ? (
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-sm ring-2 ring-indigo-200 dark:ring-indigo-800">
            <HiSparkles className="w-4 h-4 text-yellow-300" />
          </div>
        ) : (
          <MemberAvatar uid={message.senderId} noName={true} />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {isBot ? 'AI Bot' : sender?.name || 'Team Member'}
          </span>
          <span className="text-[11px] text-gray-400">
            {message.createdAt ? format(new Date(message.createdAt), 'hh:mm a') : ''}
          </span>
          {isBot && (
            <span className="bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium px-1.5 py-0.5 rounded">
              AI
            </span>
          )}
        </div>

        {/* Message Content (TipTap HTML) */}
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-gray-800 dark:text-gray-200 break-words"
          dangerouslySetInnerHTML={{ __html: message.content }}
        />

        {/* Progressive Pending / Thinking state */}
        {message.status === 'PENDING' || message.status === 'PROCESSING' ? (
          <div className="mt-2 flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-medium bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-md border border-indigo-100 dark:border-indigo-900/50">
            <HiSparkles className="w-3.5 h-3.5 animate-spin text-indigo-500" />
            <span>
              {elapsedSeconds < 20
                ? 'Bot is thinking…'
                : elapsedSeconds < 60
                ? 'Still working on it…'
                : 'Taking longer than expected…'}
            </span>
            <span className="text-[10px] opacity-60 ml-auto font-mono">{elapsedSeconds}s</span>
          </div>
        ) : null}

        {/* Failed / Timed out state */}
        {message.status === 'FAILED' && (
          <div className="mt-2 flex items-center justify-between text-red-600 dark:text-red-400 text-xs bg-red-50 dark:bg-red-950/30 px-3 py-1.5 rounded-md border border-red-100 dark:border-red-900/40">
            <span>⚠️ {message.errorMessage || 'Request timed out or failed to process.'}</span>
          </div>
        )}

        {/* Linked Task Button */}
        {message.linkedTaskId && (
          <div className="mt-3">
            <button
              onClick={() => handleOpenTask(message.linkedTaskId!)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-colors"
            >
              <span>View Task in Board</span>
              <HiArrowTopRightOnSquare className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
