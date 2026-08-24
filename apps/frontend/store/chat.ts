import { create } from 'zustand'
import { ChatMessage, ChatMessageStatus } from '@prisma/client'
import { chatGetMessages, chatSendMessage } from '@/services/chat'
import { messageError } from '@ui-components'

interface IChatStore {
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
  toggleOpen: () => void
  messages: ChatMessage[]
  isLoading: boolean
  isSending: boolean
  loadMessages: (projectId: string) => Promise<void>
  sendMessage: (projectId: string, content: string, fileIds?: string[], mentionUserIds?: string[]) => Promise<boolean>
  handleIncomingMessage: (msg: ChatMessage) => void
}

export const useChatStore = create<IChatStore>((set, get) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  messages: [],
  isLoading: false,
  isSending: false,

  loadMessages: async (projectId: string) => {
    if (!projectId) return
    try {
      set({ isLoading: true })
      const res = await chatGetMessages(projectId, { limit: 100 })
      const data = res.data?.data || []
      set({ messages: data, isLoading: false })
      if (typeof window !== 'undefined' && data.some((m: any) => m.linkedTaskId)) {
        window.dispatchEvent(new CustomEvent('crm-sync-tasks'))
      }
    } catch (error) {
      console.error('[Chat Store] Failed to load messages:', error)
      set({ isLoading: false })
    }
  },

  sendMessage: async (projectId: string, content: string, fileIds = [], mentionUserIds = []) => {
    if (!content || !content.trim()) return false

    try {
      set({ isSending: true })
      const res = await chatSendMessage(projectId, {
        content,
        fileIds,
        mentionUserIds
      })

      const sentMsg = res.data?.data
      if (sentMsg) {
        set((state) => {
          const exists = state.messages.some((m) => m.id === sentMsg.id)
          if (!exists) {
            return { messages: [...state.messages, sentMsg] }
          }
          return state
        })
      }
      set({ isSending: false })
      return true
    } catch (error) {
      console.error('[Chat Store] Send error:', error)
      messageError('Failed to send message')
      set({ isSending: false })
      return false
    }
  },

  handleIncomingMessage: (msg: ChatMessage) => {
    if (!msg || !msg.id) return
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === msg.id)
      if (idx >= 0) {
        const updated = [...state.messages]
        updated[idx] = msg
        return { messages: updated }
      } else {
        return { messages: [...state.messages, msg] }
      }
    })

    // If message is linked to a task or is a bot completion reply, trigger board task sync
    if (typeof window !== 'undefined' && (msg.linkedTaskId || (msg as any).isBotReply)) {
      window.dispatchEvent(new CustomEvent('crm-sync-tasks'))
    }
  }
}))
