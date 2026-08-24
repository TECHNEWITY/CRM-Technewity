'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Form, Button, messageError } from '@ui-components'
import Mention from '@tiptap/extension-mention'
import { useMemberStore } from '@/store/member'
import { aiRephrase } from '@/services/ai'
import { storageCreatePresignedUrl, storagePutFile } from '@/services/storage'
import { useGlobalDataStore } from '@/store/global'
import DropFileZone from '@/components/DropFileZone'
import {
  HiPaperClip,
  HiPaperAirplane,
  HiXMark,
  HiSparkles,
  HiQuestionMarkCircle,
  HiCheckCircle,
  HiCommandLine
} from 'react-icons/hi2'
import { httpGet } from '@/services/_req'

const ABSOLUTE_MAX_MB = 35 // Hard ceiling in megabytes; quota API may lower this
const BYTES_PER_MB = 1024 * 1024

interface CommandBubble {
  id: string
  label: string
  command: string
  hint: string
  icon: string
  color: 'indigo' | 'rose' | 'amber' | 'emerald' | 'purple'
  template?: string
}

const COMMAND_BUBBLES: CommandBubble[] = [
  {
    id: 'task',
    label: '/Task',
    command: '/Task @bot ',
    hint: 'Create a structured task with priority, due date, points & checklist',
    icon: '📋',
    color: 'indigo',
    template: '/Task @bot Write blog post for launch. priority: high due: friday points: 3 #marketing lead: @'
  },
  {
    id: 'bug',
    label: '/Bug',
    command: '/Bug @bot ',
    hint: 'Report an issue or defect with auto-prioritization',
    icon: '🐛',
    color: 'rose',
    template: '/Bug @bot 500 server error when uploading invoice PDF priority: urgent'
  },
  {
    id: 'feature',
    label: '/Feature',
    command: '/Feature @bot ',
    hint: 'Request a new capability or feature',
    icon: '✨',
    color: 'purple',
    template: '/Feature @bot Add Dark Mode switch to user settings due: next week #ui'
  },
  {
    id: 'improvement',
    label: '/Improvement',
    command: '/Improvement @bot ',
    hint: 'Log an enhancement or optimization to an existing feature',
    icon: '⚡',
    color: 'emerald',
    template: '/Improvement @bot Optimize dashboard loading speed by caching queries'
  },
  {
    id: 'report',
    label: '/Report',
    command: '/Report @bot ',
    hint: 'Generate weekly/monthly project progress report and member stats',
    icon: '📊',
    color: 'indigo',
    template: '/Report @bot weekly summary'
  },
  {
    id: 'schedule',
    label: '/Schedule',
    command: '/Schedule @bot ',
    hint: 'Set up an automated recurring cron action (e.g. weekly report or overdue alerts)',
    icon: '⏰',
    color: 'amber',
    template: '/Schedule @bot send weekly report every monday at 9am'
  },
  {
    id: 'email',
    label: '/Email',
    command: '/Email @bot ',
    hint: 'Draft & dispatch an outbound email via AI',
    icon: '✉️',
    color: 'amber',
    template: '/Email @bot Send project update summary to '
  }
]

export default function ChatMessageInput({
  projectId,
  onSendMessage,
  isSending
}: {
  projectId: string
  onSendMessage: (content: string, fileIds: string[], mentionUserIds: string[]) => Promise<boolean>
  isSending: boolean
}) {
  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<
    { id?: string; name: string; size?: number; uploading?: boolean }[]
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { members } = useMemberStore()
  const { orgId } = useGlobalDataStore()

  // Dynamic storage quota state
  const [quotaUsedBytes, setQuotaUsedBytes] = useState<number>(0)
  const [quotaTotalBytes, setQuotaTotalBytes] = useState<number>(ABSOLUTE_MAX_MB * BYTES_PER_MB)
  const [perFileMaxBytes, setPerFileMaxBytes] = useState<number>(ABSOLUTE_MAX_MB * BYTES_PER_MB)

  const refreshQuota = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await httpGet(`/api/storage/quota?orgId=${orgId}`)
      const { usedBytes, totalBytes } = res.data?.data || {}
      if (typeof totalBytes === 'number' && typeof usedBytes === 'number') {
        const remainingBytes = Math.max(0, totalBytes - usedBytes)
        setQuotaUsedBytes(usedBytes)
        setQuotaTotalBytes(totalBytes)
        setPerFileMaxBytes(Math.min(remainingBytes, ABSOLUTE_MAX_MB * BYTES_PER_MB))
      }
    } catch {
      // Non-critical — fallback on quota failure
    }
  }, [orgId])

  useEffect(() => {
    refreshQuota()
  }, [refreshQuota])

  // Bot + members list for @mention suggestions
  const mentionItems = [
    { id: 'BOT_USER', label: 'bot', email: 'bot@technewity.ai' },
    ...members.map((m) => ({
      id: m.id,
      label: m.name || m.id,
      email: m.email || ''
    }))
  ]

  const handleRephrase = async (text: string) => {
    try {
      const res = await aiRephrase(text, orgId)
      return res.data?.data?.rephrasedText || text
    } catch (error) {
      console.error('Rephrase error:', error)
      return text
    }
  }

  const handleFilesDropped = async (files: File[]) => {
    if (!files.length) return

    for (const file of files) {
      const capMB = Math.round(perFileMaxBytes / BYTES_PER_MB)
      if (file.size > perFileMaxBytes) {
        messageError(
          `"${file.name}" exceeds the current per-file limit of ${capMB} MB. ` +
            `(${Math.round(quotaUsedBytes / BYTES_PER_MB)} MB of ${Math.round(quotaTotalBytes / BYTES_PER_MB)} MB used)`
        )
        continue
      }

      setAttachedFiles((prev) => [...prev, { name: file.name, size: file.size, uploading: true }])

      try {
        const presignedRes = await storageCreatePresignedUrl({
          orgId,
          projectId,
          name: file.name,
          type: file.type || 'application/octet-stream'
        })

        const { presignedUrl, name: keyName } = presignedRes.data?.data || {}
        if (presignedUrl) {
          await storagePutFile(presignedUrl, file)
        }

        setAttachedFiles((prev) =>
          prev.map((f) =>
            f.name === file.name && f.uploading ? { ...f, id: keyName, uploading: false } : f
          )
        )

        await refreshQuota()
      } catch (err) {
        console.error('File upload error:', err)
        messageError(`Failed to upload ${file.name}`)
        setAttachedFiles((prev) => prev.filter((f) => f.name !== file.name))
      }
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesDropped(Array.from(e.target.files))
      e.target.value = '' // Reset input
    }
  }

  const handleRemoveFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (htmlContent?: string) => {
    const contentToSend = htmlContent !== undefined ? htmlContent : value
    if (!contentToSend || !contentToSend.trim()) return

    const readyFileIds = attachedFiles.filter((f) => f.id && !f.uploading).map((f) => f.id!)

    const mentionIds: string[] = []
    // 1. Extract from data-id attributes
    const regex = /data-id="([a-f0-9]+|BOT_USER)"/gi
    let match
    while ((match = regex.exec(contentToSend)) !== null) {
      if (match[1] && !mentionIds.includes(match[1])) {
        mentionIds.push(match[1])
      }
    }

    // 2. Also match any @Name in text against known members
    const cleanText = contentToSend.replace(/<[^>]*>/g, ' ')
    for (const item of mentionItems) {
      if (item.id === 'BOT_USER' || !item.label) continue
      const escaped = item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const namePattern = new RegExp(`@${escaped}(?!\\w)`, 'i')
      if (namePattern.test(cleanText) && !mentionIds.includes(item.id)) {
        mentionIds.push(item.id)
      }
    }

    const success = await onSendMessage(contentToSend, readyFileIds, mentionIds)
    if (success) {
      setValue('')
      setAttachedFiles([])
      await refreshQuota()
    }
  }

  const handleInsertCommand = (cmd: string) => {
    setValue((prev) => (prev ? `${prev} ${cmd}` : cmd))
  }

  const handleInsertTemplate = (template: string) => {
    setValue(template)
  }

  const usedMB = Math.round(quotaUsedBytes / BYTES_PER_MB)
  const totalMB = Math.round(quotaTotalBytes / BYTES_PER_MB)
  const perFileMB = Math.max(1, Math.round(perFileMaxBytes / BYTES_PER_MB))
  const usedPct = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0

  return (
    <DropFileZone
      onChange={handleFilesDropped}
      className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 transition-colors"
    >
      {/* Hidden File Input for Paperclip click */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        className="hidden"
      />

      {/* Interactive Command Hint Bubbles Bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium">
            <HiCommandLine className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px] font-semibold tracking-wide uppercase">AI Commands & Hints</span>
          </div>
          <button
            type="button"
            onClick={() => setShowGuide((prev) => !prev)}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            <HiQuestionMarkCircle className="w-3.5 h-3.5" />
            <span>{showGuide ? 'Hide Examples' : 'Show Examples'}</span>
          </button>
        </div>

        {/* Command Pill Bubbles with clean scroll */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {COMMAND_BUBBLES.map((bubble) => {
            const colorClasses = {
              indigo:
                'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60',
              rose:
                'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/60',
              amber:
                'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/60',
              emerald:
                'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60',
              purple:
                'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200/70 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/60'
            }[bubble.color]

            return (
              <button
                key={bubble.id}
                type="button"
                title={bubble.hint}
                onClick={() => handleInsertCommand(bubble.command)}
                className={`group px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all shadow-2xs shrink-0 active:scale-95 touch-manipulation ${colorClasses}`}
              >
                <span>{bubble.icon}</span>
                <span className="font-semibold">{bubble.label}</span>
              </button>
            )
          })}
        </div>

        {/* Collapsible Examples Panel only when user clicks 'Show Examples' */}
        {showGuide && (
          <div className="mt-2 p-2.5 bg-gradient-to-r from-indigo-50/70 via-purple-50/40 to-slate-50/70 dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-slate-900/30 rounded-lg border border-indigo-100 dark:border-indigo-900/40 text-xs animate-in fade-in duration-200 max-h-48 overflow-y-auto">
            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1">
              <HiSparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>Click an example prompt to insert directly:</span>
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {COMMAND_BUBBLES.filter((b) => b.template).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => handleInsertTemplate(b.template!)}
                  className="text-left px-2 py-1 rounded bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 border border-gray-200/60 dark:border-gray-700/60 text-gray-700 dark:text-gray-300 font-mono text-[11px] truncate transition-colors shadow-2xs hover:border-indigo-300 active:scale-98"
                >
                  <span className="mr-1">{b.icon}</span>
                  <span>{b.template}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Attached Files List */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachedFiles.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs rounded-md border border-gray-200 dark:border-gray-700 shadow-2xs"
            >
              <HiPaperClip className="w-3.5 h-3.5 text-gray-400" />
              <span className="max-w-[160px] truncate font-medium">{file.name}</span>
              {file.uploading ? (
                <span className="text-[10px] text-indigo-500 font-medium animate-pulse flex items-center gap-1">
                  <span>uploading...</span>
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  <HiCheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(idx)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <HiXMark className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* TipTap Rich Text Composer */}
      <div
        className="relative"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 250)}
      >
        <Form.RichTextEditor
          value={value}
          onRephrase={handleRephrase}
          onCtrlEnter={(v) => handleSubmit(v)}
          extensions={[
            Mention.configure({
              HTMLAttributes: { class: 'mention' },
              renderHTML({ options, node }) {
                return [
                  'span',
                  {
                    class: 'mention',
                    'data-type': 'mention',
                    'data-id': node.attrs.id,
                    'data-label': node.attrs.label
                  },
                  `@${node.attrs.label ?? node.attrs.id}`
                ]
              },
              suggestion: Form.getMentionSuggestion(mentionItems)
            })
          ]}
        />
      </div>

      {/* Footer / Helper Bar */}
      <div className="flex items-center justify-between mt-2 pt-1 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Direct File Picker Button */}
          <button
            type="button"
            title="Attach file (or drag & drop)"
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors border border-gray-200 dark:border-gray-700 shrink-0"
          >
            <HiPaperClip className="w-4 h-4" />
          </button>

          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] text-gray-400 truncate">
              Tip: Type <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-indigo-600 dark:text-indigo-400 font-semibold">@bot</code> to invoke AI · Ctrl+Enter to send
            </span>
            <span
              className={`text-[10px] font-medium ${usedPct >= 80 ? 'text-red-500 font-semibold' : 'text-gray-400'}`}
            >
              {usedMB} MB of {totalMB} MB used · Max {perFileMB} MB per file
              {usedPct >= 80 && ' ⚠️ Free storage nearing limit'}
            </span>
          </div>
        </div>

        {/* Send Button */}
        <Button
          size="sm"
          onClick={() => handleSubmit()}
          loading={isSending}
          title="Send"
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 flex items-center gap-1.5 flex-shrink-0 shadow-xs"
          leadingIcon={<HiPaperAirplane className="w-3.5 h-3.5" />}
        />
      </div>
    </DropFileZone>
  )
}
