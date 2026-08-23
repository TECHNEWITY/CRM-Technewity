import { Router } from 'express'
import { ChatCommandType, ChatMessageStatus } from '@prisma/client'
import { ChatRepository, ensureBotUserForOrg, pmClient } from '@database'
import { authMiddleware, beProjectMemberMiddleware } from '../../middlewares'
import { AuthRequest } from '../../types'
import { pusherTrigger } from '../../lib/pusher-server'
import { getBotQueueInstance } from '../../queues/Bot'

const router = Router()
const chatRepo = new ChatRepository()

// Helper to extract mention user IDs from TipTap mention HTML
const extractMentionIdsFromHtml = (html: string): string[] => {
  const ids: string[] = []
  const regex = /data-id="([a-f0-9]+)"/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    if (match[1] && !ids.includes(match[1])) {
      ids.push(match[1])
    }
  }
  return ids
}

// POST /api/project/:projectId/chat/message
router.post('/project/:projectId/chat/message', [authMiddleware, beProjectMemberMiddleware], async (req: AuthRequest, res) => {
  const { projectId } = req.params
  const { id: userId } = req.authen
  const { content, fileIds = [], mentionUserIds = [], organizationId } = req.body as {
    content: string
    fileIds?: string[]
    mentionUserIds?: string[]
    organizationId?: string
  }

  if (!content || !content.trim()) {
    return res.status(400).json({ status: 400, error: 'Message content is required' })
  }

  try {
    // Resolve organizationId from project if not provided
    let orgId = organizationId
    if (!orgId) {
      const project = await pmClient.project.findUnique({
        where: { id: projectId },
        select: { organizationId: true }
      })
      orgId = project?.organizationId || ''
    }

    // Merge explicitly provided mention IDs with any parsed from HTML
    const htmlMentionIds = extractMentionIdsFromHtml(content)
    const combinedMentionIds = Array.from(new Set([...(mentionUserIds || []), ...htmlMentionIds]))

    // Match any @Name against project and organization members
    const projectMembers = await pmClient.members.findMany({
      where: { projectId },
      include: { users: true }
    })
    const orgMembers = orgId
      ? await pmClient.organizationMembers.findMany({
          where: { organizationId: orgId },
          include: { users: true }
        })
      : []

    const allMembers = [
      ...projectMembers.map((m: any) => ({ id: m.uid, name: m.users?.name })),
      ...orgMembers.map((m: any) => ({ id: m.uid, name: m.users?.name }))
    ]

    const plainText = content.replace(/<[^>]*>/g, ' ')
    for (const m of allMembers) {
      if (!m.name) continue
      const escaped = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`@${escaped}(?!\\w)`, 'i')
      if (pattern.test(plainText) || pattern.test(content)) {
        if (!combinedMentionIds.includes(m.id)) {
          combinedMentionIds.push(m.id)
        }
      }
    }

    // Find Bot User for this organization (org-scoped)
    const botUser = orgId ? await ensureBotUserForOrg(orgId) : null
    const botUserId = botUser?.id

    // Check if bot should be triggered:
    // 1. Bot user explicitly @mentioned in mentionUserIds
    // 2. Starts with /task, /bug, /email slash command
    // 3. Mentions "@bot" or "@ai" in raw text
    const isBotMentioned =
      (botUserId && combinedMentionIds.includes(botUserId)) ||
      /^\s*\/(task|bug|email)\b/i.test(content) ||
      /@(?:bot|ai)\b/i.test(content)

    // Detect slash command if any
    let commandType: ChatCommandType | null = null
    if (/^\s*\/task\b/i.test(content)) commandType = ChatCommandType.TASK
    if (/^\s*\/bug\b/i.test(content)) commandType = ChatCommandType.BUG
    if (/^\s*\/email\b/i.test(content)) commandType = ChatCommandType.EMAIL

    const initialStatus = isBotMentioned ? ChatMessageStatus.PENDING : ChatMessageStatus.SENT

    const message = await chatRepo.createMessage({
      organizationId: orgId,
      projectId,
      senderId: userId,
      content,
      mentionUserIds: combinedMentionIds,
      fileIds,
      commandType,
      status: initialStatus,
      linkedTaskId: null,
      errorMessage: null,
      isBotReply: false
    })

    // Broadcast user's message immediately via Pusher
    pusherTrigger('team-collab', `chat-message-${projectId}`, message)

    // If bot was invoked, asynchronously enqueue the job to BullMQ
    if (isBotMentioned) {
      console.log(`[Chat API] Enqueueing bot message processing for message: ${message.id}`)
      try {
        const botQueue = getBotQueueInstance()
        await botQueue.enqueueBotMessage({
          chatMessageId: message.id,
          projectId,
          organizationId: orgId,
          senderId: userId
        })
      } catch (queueErr) {
        console.error('[Chat API] Failed to enqueue bot job:', queueErr)
      }
    }

    return res.json({
      status: 200,
      data: message
    })
  } catch (error) {
    console.error('[Chat API Error]', error)
    return res.status(500).json({ status: 500, error })
  }
})

// GET /api/project/:projectId/chat/messages
router.get('/project/:projectId/chat/messages', [authMiddleware, beProjectMemberMiddleware], async (req: AuthRequest, res) => {
  const { projectId } = req.params
  const { limit = 50, before } = req.query as { limit?: string | number; before?: string }

  try {
    const parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : limit
    const messages = await chatRepo.getMessagesByProject(projectId, parsedLimit || 50, before)

    return res.json({
      status: 200,
      data: messages
    })
  } catch (error) {
    console.error('[Chat API Get Messages Error]', error)
    return res.status(500).json({ status: 500, error })
  }
})

export default router
