import { TaskPriority, TaskType } from '@prisma/client'
import {
  AiUsageLogRepository,
  ChatRepository,
  NotificationRepository,
  pmClient
} from '@database'
import TaskCreateService from '../task/create.service'
import { parseTaskWithGemini } from './gemini.client'
import { sendEmail } from '../../lib/email'
import { pusherTrigger } from '../../lib/pusher-server'
import { genFrontendUrl } from '../../lib/url'
import { incrCache } from '../../lib/redis'

// Local enum constants — mirrors schema enums, safe until Prisma client regenerates
const ChatCommandType = {
  TASK: 'TASK',
  BUG: 'BUG',
  EMAIL: 'EMAIL',
  GENERAL: 'GENERAL'
} as const
type ChatCommandType = typeof ChatCommandType[keyof typeof ChatCommandType]

const ChatMessageStatus = {
  SENT: 'SENT',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
} as const
type ChatMessageStatus = typeof ChatMessageStatus[keyof typeof ChatMessageStatus]

export class BotOrchestratorService {
  chatRepo: ChatRepository
  aiUsageRepo: AiUsageLogRepository
  notificationRepo: NotificationRepository
  taskCreateService: TaskCreateService

  constructor() {
    this.chatRepo = new ChatRepository()
    this.aiUsageRepo = new AiUsageLogRepository()
    this.notificationRepo = new NotificationRepository()
    this.taskCreateService = new TaskCreateService()
  }

  /**
   * Converts TipTap HTML to normalized plain text while preserving mentions
   */
  private htmlToPlainText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Deterministic slash command parser — takes precedence over LLM output
   */
  private extractSlashCommand(text: string): ChatCommandType | null {
    const trimmed = text.trim()
    if (/^\/task\b/i.test(trimmed)) return ChatCommandType.TASK
    if (/^\/bug\b/i.test(trimmed)) return ChatCommandType.BUG
    if (/^\/email\b/i.test(trimmed)) return ChatCommandType.EMAIL
    return null
  }

  /**
   * Deterministic Lead extraction via natural language keywords.
   * Convention: "lead: @Name", "lead is @Name", "lead will be @Name"
   * Fallback: first @mention becomes lead.
   *
   * SIGN-OFF CONFIRMED: natural-language lead detection with regex, per user decision.
   * If org has strict accountability needs, upgrade to explicit `/lead @Name` syntax.
   */
  private extractLeadId({
    htmlContent,
    plainText,
    candidateMemberIds,
    members
  }: {
    htmlContent: string
    plainText: string
    candidateMemberIds: string[]
    members: Array<{ id: string; name: string | null; email: string }>
  }): { leadId: string | null; assigneeIds: string[] } {
    let leadId: string | null = null

    // 1. Look for TipTap mention span right after "lead:" / "lead is" / "lead will be"
    const leadMentionRegex = /(?:lead\s*(?::|is|will be))\s*<span[^>]*data-id="([a-f0-9]+)"/i
    const match = htmlContent.match(leadMentionRegex)
    if (match && match[1] && candidateMemberIds.includes(match[1])) {
      leadId = match[1]
    }

    // 2. Fallback: plain text "lead: @Name" or "lead @Name"
    if (!leadId) {
      for (const m of members) {
        if (!m.name) continue
        const nameRegex = new RegExp(`(?:lead\\s*(?::|is|will be))\\s*@?${m.name}`, 'i')
        if (nameRegex.test(plainText) && candidateMemberIds.includes(m.id)) {
          leadId = m.id
          break
        }
      }
    }

    const assigneeIds = candidateMemberIds.filter(id => id !== leadId)
    // If no explicit lead but mentions exist, first mention is lead
    if (!leadId && candidateMemberIds.length > 0) {
      leadId = candidateMemberIds[0]
    }

    return {
      leadId,
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : (leadId ? [leadId] : [])
    }
  }

  /**
   * Extract literal email address from text.
   * Email hardening: flag if address is not an existing project member.
   */
  private extractLiteralEmail(text: string): string | null {
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i
    const match = text.match(emailRegex)
    return match ? match[1] : null
  }

  /**
   * Daily rate limit check via Redis counter
   */
  public async checkRateLimit(userId: string): Promise<boolean> {
    const limit = parseInt(process.env.BOT_RATE_LIMIT_PER_USER_PER_DAY || '50', 10)
    const today = new Date().toISOString().split('T')[0]
    const key = [`bot-limit`, userId, today]
    const current = await incrCache(key)
    return current <= limit
  }

  /**
   * Main async execution pipeline called by the BullMQ worker
   */
  public async processMessage(chatMessageId: string): Promise<void> {
    const message = await this.chatRepo.getMessageById(chatMessageId)
    if (!message) {
      console.warn(`[BotOrchestrator] Message ${chatMessageId} not found`)
      return
    }

    const { projectId, organizationId, senderId, content, fileIds, mentionUserIds } = message as any

    // Find Bot User — search by email pattern (isBot field available after Prisma regen)
    const botUser = await pmClient.user.findFirst({
      where: { email: { contains: 'bot+' } }
    })
    const botUserId = botUser?.id || 'BOT_USER'

    try {
      await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.PROCESSING as any)

      // Daily rate limit guard
      const isAllowed = await this.checkRateLimit(senderId)
      if (!isAllowed) {
        const limitReply = await this.chatRepo.createMessage({
          organizationId,
          projectId,
          senderId: botUserId,
          content: `<p>⚠️ You have reached your daily AI bot limit (${process.env.BOT_RATE_LIMIT_PER_USER_PER_DAY || 50} requests/day). Please try again tomorrow.</p>`,
          mentionUserIds: [senderId],
          fileIds: [],
          commandType: ChatCommandType.GENERAL as any,
          status: ChatMessageStatus.COMPLETED as any,
          linkedTaskId: null,
          errorMessage: null,
          isBotReply: true
        })

        pusherTrigger('team-collab', `chat-message-${projectId}`, limitReply)
        await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.COMPLETED as any)
        return
      }

      // Fetch project and member list
      const project = await pmClient.project.findUnique({ where: { id: projectId } })
      const projectMembers = await pmClient.members.findMany({
        where: { projectId },
        include: { users: true }
      })

      const memberMap = new Map<string, any>()
      const memberNames: string[] = []
      projectMembers.forEach((pm: any) => {
        const name = pm.users?.name || pm.uid
        const email = pm.users?.email || ''
        memberMap.set(pm.uid, { id: pm.uid, name, email })
        memberNames.push(`${name} (${email})`)
      })

      // Deterministic parsing (slash commands + lead keyword)
      const plainText = this.htmlToPlainText(content)
      const commandType = this.extractSlashCommand(plainText)
      const candidateUserIds = ((mentionUserIds as string[]) || []).filter(uid => uid !== botUserId)

      const { leadId, assigneeIds } = this.extractLeadId({
        htmlContent: content,
        plainText,
        candidateMemberIds: candidateUserIds,
        members: Array.from(memberMap.values())
      })

      // Gemini structured extraction
      const aiResult = await parseTaskWithGemini({
        rawText: plainText,
        commandHint: commandType as any,
        memberNames
      })

      await this.aiUsageRepo.logUsage({
        organizationId,
        userId: senderId,
        chatMessageId,
        action: 'PARSE_TASK',
        tokensUsed: 150,
        success: true
      })

      const finalIntent = (commandType || aiResult.intent) as string

      // ─── Branch 1: EMAIL INTENT ───────────────────────────────────────────────
      if (finalIntent === 'EMAIL') {
        const literalEmail = this.extractLiteralEmail(plainText)
        let targetEmail = literalEmail

        // If no literal email, resolve from mentioned member
        if (!targetEmail && candidateUserIds.length > 0) {
          const targetMember = memberMap.get(candidateUserIds[0])
          if (targetMember?.email) targetEmail = targetMember.email
        }

        if (!targetEmail) {
          throw new Error('No valid recipient email address or mentioned user with email found.')
        }

        // SECURITY HARDENING: Flag if recipient is not a project member
        const isKnownMember = Array.from(memberMap.values()).some(
          (m: any) => m.email.toLowerCase() === targetEmail!.toLowerCase()
        )
        if (!isKnownMember) {
          console.warn(
            `[BotOrchestrator Security] Email to unknown address "${targetEmail}" — not in project members. Logging event.`
          )
          await this.aiUsageRepo.logUsage({
            organizationId,
            userId: senderId,
            chatMessageId,
            action: 'EMAIL_TO_UNKNOWN_RECIPIENT',
            success: true
          })
        }

        const emailSubject = aiResult.email_subject || aiResult.title || 'CRM Message Notification'
        const emailBody = aiResult.email_body || aiResult.rephrased_description

        await sendEmail({
          emails: [targetEmail],
          subject: emailSubject,
          html: `<div style="font-family: sans-serif; line-height: 1.5; color: #333;">
            <p>${emailBody}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #888;">Dispatched via ${process.env.NEXT_PUBLIC_APP_NAME || 'Technewity CRM'} AI Bot${!isKnownMember ? ' · <strong>External recipient</strong>' : ''}</p>
          </div>`
        })

        await this.notificationRepo.createNotification({
          organizationId,
          userId: senderId,
          type: 'BOT_EMAIL_SENT',
          title: `Email dispatched to ${targetEmail}${!isKnownMember ? ' (external)' : ''}`,
          body: emailSubject,
          link: `/${project?.organizationId}/project/${projectId}`
        })

        const botReply = await this.chatRepo.createMessage({
          organizationId,
          projectId,
          senderId: botUserId,
          content: `<p>✉️ <strong>Email Sent!</strong></p>
          <p><strong>To:</strong> ${targetEmail}${!isKnownMember ? ' <em>(external address — not a project member)</em>' : ''}<br/>
          <strong>Subject:</strong> ${emailSubject}</p>
          <p>${emailBody}</p>`,
          mentionUserIds: [senderId],
          fileIds: [],
          commandType: ChatCommandType.EMAIL as any,
          status: ChatMessageStatus.COMPLETED as any,
          linkedTaskId: null,
          errorMessage: null,
          isBotReply: true
        })

        pusherTrigger('team-collab', `chat-message-${projectId}`, botReply)
        await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.COMPLETED as any, {
          commandType: ChatCommandType.EMAIL as any
        })
        return
      }

      // ─── Branch 2: TASK / BUG INTENT ─────────────────────────────────────────
      if (finalIntent === 'TASK' || finalIntent === 'BUG') {
        const taskType = finalIntent === 'BUG' ? TaskType.BUG : TaskType.TASK

        const effectiveAssignees = assigneeIds.length > 0 ? assigneeIds : [senderId]
        const effectiveLeadId = leadId || effectiveAssignees[0]

        const createdTask = await this.taskCreateService.createNewTask({
          uid: senderId,
          body: {
            id: undefined as any,
            title: aiResult.title,
            desc: aiResult.rephrased_description,
            type: taskType,
            projectId,
            assigneeIds: effectiveAssignees,
            leadId: effectiveLeadId,
            fileIds: fileIds || [],
            priority: TaskPriority.NORMAL,
            createdVia: 'BOT' as any,
            order: 0,
            dueDate: null,
            cover: null,
            startDate: null,
            plannedStartDate: null,
            plannedDueDate: null,
            visionId: null,
            taskStatusId: null,
            tagIds: [],
            parentTaskId: null,
            progress: 0,
            done: false,
            taskPoint: null,
            customFields: {},
            checklistDone: 0,
            checklistTodos: 0,
            createdBy: senderId,
            createdAt: new Date(),
            updatedBy: null,
            updatedAt: null
          } as any
        })

        const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Technewity CRM'
        const taskUrl = genFrontendUrl(`${project?.organizationId}/project/${projectId}?mode=task&taskId=${createdTask.id}`)

        // In-app notifications for all assigned members + lead
        const notifyTargetUserIds = Array.from(new Set([...effectiveAssignees, effectiveLeadId]))
        for (const targetUid of notifyTargetUserIds) {
          if (targetUid === senderId) continue

          await this.notificationRepo.createNotification({
            organizationId,
            userId: targetUid,
            type: 'TASK_ASSIGNED',
            title: `Assigned to ${taskType}: "${createdTask.title}"`,
            body: aiResult.rephrased_description.slice(0, 150),
            link: taskUrl
          })

          const targetMember = memberMap.get(targetUid)
          if (targetMember?.email) {
            await sendEmail({
              emails: [targetMember.email],
              subject: `[${appName}] New ${taskType} Assigned: "${createdTask.title}"`,
              html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2>You were assigned a new ${taskType.toLowerCase()} by AI Bot</h2>
                <p><strong>Title:</strong> ${createdTask.title}</p>
                <p><strong>Description:</strong> ${aiResult.rephrased_description}</p>
                <p><a href="${taskUrl}" style="background-color: #4f46e5; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block;">View Task</a></p>
              </div>`
            }).catch((e: any) => console.error('[BotOrchestrator Email Error]', e))
          }
        }

        const leadMember = memberMap.get(effectiveLeadId)
        const assigneeNames = effectiveAssignees.map((id: string) => memberMap.get(id)?.name || id).join(', ')

        const botReply = await this.chatRepo.createMessage({
          organizationId,
          projectId,
          senderId: botUserId,
          content: `<p>✨ <strong>${taskType === 'BUG' ? 'Bug' : 'Task'} Created!</strong></p>
          <p><strong>Title:</strong> ${createdTask.title}</p>
          <p>${aiResult.rephrased_description}</p>
          <p>👤 <strong>Lead:</strong> ${leadMember?.name || 'Unassigned'} | 👥 <strong>Assignees:</strong> ${assigneeNames}</p>`,
          mentionUserIds: [senderId, ...notifyTargetUserIds],
          fileIds: fileIds || [],
          commandType: (taskType === TaskType.BUG ? ChatCommandType.BUG : ChatCommandType.TASK) as any,
          status: ChatMessageStatus.COMPLETED as any,
          linkedTaskId: createdTask.id,
          errorMessage: null,
          isBotReply: true
        })

        pusherTrigger('team-collab', `chat-message-${projectId}`, botReply)
        await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.COMPLETED as any, {
          linkedTaskId: createdTask.id,
          commandType: (taskType === TaskType.BUG ? ChatCommandType.BUG : ChatCommandType.TASK) as any
        })
        return
      }

      // ─── Branch 3: UNCLEAR INTENT ─────────────────────────────────────────────
      const unclearReply = await this.chatRepo.createMessage({
        organizationId,
        projectId,
        senderId: botUserId,
        content: `<p>❓ I couldn't determine your intent. Please use <code>/Task</code>, <code>/Bug</code>, or <code>/Email</code> to help me understand what to do, then @mention assignees and add <em>lead: @Name</em> if needed.</p>`,
        mentionUserIds: [senderId],
        fileIds: [],
        commandType: ChatCommandType.GENERAL as any,
        status: ChatMessageStatus.COMPLETED as any,
        linkedTaskId: null,
        errorMessage: null,
        isBotReply: true
      })

      pusherTrigger('team-collab', `chat-message-${projectId}`, unclearReply)
      await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.COMPLETED as any)

    } catch (error: any) {
      console.error('[BotOrchestrator Error]', error)
      const errorMsg = error?.message || 'An unexpected error occurred.'

      await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.FAILED as any, {
        errorMessage: errorMsg
      })

      const botErrorReply = await this.chatRepo.createMessage({
        organizationId,
        projectId,
        senderId: botUserId,
        content: `<p>❌ <strong>Error:</strong> ${errorMsg}</p>`,
        mentionUserIds: [senderId],
        fileIds: [],
        commandType: ChatCommandType.GENERAL as any,
        status: ChatMessageStatus.FAILED as any,
        linkedTaskId: null,
        errorMessage: errorMsg,
        isBotReply: true
      })

      pusherTrigger('team-collab', `chat-message-${projectId}`, botErrorReply)
    }
  }
}
