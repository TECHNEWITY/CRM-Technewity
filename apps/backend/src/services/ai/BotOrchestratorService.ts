import { ChatCommandType, ChatMessageStatus, TaskPriority, TaskType } from '@prisma/client'
import { ChatRepository, ensureBotUserForOrg, pmClient } from '@database'
import TaskCreateService from '../task/create.service'
import { parseTaskWithGemini } from './gemini.client'
import { AiUsageLogRepository } from '@database'
import { NotificationRepository } from '@database'
import { sendEmail } from '../../lib/email'
import { pusherTrigger } from '../../lib/pusher-server'
import { incrCache } from '../../lib/redis'
import { genFrontendUrl } from '../../lib/url'

/**
 * Escapes all regular expression special characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class BotOrchestratorService {
  public chatRepo: ChatRepository
  public taskCreateService: TaskCreateService
  public aiUsageRepo: AiUsageLogRepository
  public notificationRepo: NotificationRepository

  // In-memory cache for org-scoped bot user IDs
  private botUserCache: Map<string, string> = new Map()

  constructor() {
    this.chatRepo = new ChatRepository()
    this.taskCreateService = new TaskCreateService()
    this.aiUsageRepo = new AiUsageLogRepository()
    this.notificationRepo = new NotificationRepository()
  }

  /**
   * Helper to retrieve org-scoped bot user ID.
   * Enforces 100% tenant isolation (never falls back to literal 'BOT_USER').
   */
  public async getBotUserIdForOrg(organizationId: string): Promise<string> {
    if (this.botUserCache.has(organizationId)) {
      return this.botUserCache.get(organizationId)!
    }
    const botUser = await ensureBotUserForOrg(organizationId)
    this.botUserCache.set(organizationId, botUser.id)
    return botUser.id
  }

  /**
   * Extract explicit slash command (/Task, /Bug, /Email) from text.
   */
  public extractSlashCommand(text: string): 'TASK' | 'BUG' | 'EMAIL' | null {
    const trimmed = text.trim()
    if (/^\/task\b/i.test(trimmed)) return 'TASK'
    if (/^\/bug\b/i.test(trimmed)) return 'BUG'
    if (/^\/email\b/i.test(trimmed)) return 'EMAIL'
    return null
  }

  /**
   * Converts TipTap / ProseMirror HTML into clean plain text for AI parsing.
   */
  public htmlToPlainText(html: string): string {
    if (!html) return ''
    return html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<\/div>/gi, ' ')
      .replace(/<span[^>]*class="[^"]*mention[^"]*"[^>]*>(.*?)<\/span>/gi, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Robust Lead and Assignee extraction supporting:
   * 1. HTML <span data-id="...">
   * 2. HTML <span class="mention">@Name</span>
   * 3. Plain text "lead: @Name" or "lead is @Name" with spaces and regex special chars
   * 4. Candidate members sorted by name length descending to avoid prefix mismatches ("Om" vs "Omkar")
   */
  public extractLeadId({
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
    const detectedAssigneeIds = new Set<string>(candidateMemberIds)

    const sortedMembers = [...members]
      .filter((m) => !!m.name)
      .sort((a, b) => (b.name || '').length - (a.name || '').length)

    // 1. TipTap mention span with data-id right after "lead:" / "lead is" / "lead will be"
    const leadMentionRegex = /(?:lead\s*(?::|is|will be))\s*<span[^>]*data-id="([a-f0-9]+)"/i
    const match = htmlContent.match(leadMentionRegex)
    if (match && match[1]) {
      leadId = match[1]
      detectedAssigneeIds.add(leadId)
    }

    // 2. TipTap mention span with text: lead: <span class="mention">@Name</span>
    if (!leadId) {
      const spanNameRegex = /(?:lead\s*(?::|is|will be))\s*<span[^>]*class="[^"]*mention[^"]*"[^>]*>@?([^<]+)<\/span>/i
      const spanMatch = htmlContent.match(spanNameRegex)
      if (spanMatch && spanMatch[1]) {
        const targetName = spanMatch[1].trim().toLowerCase()
        const matchedMember = sortedMembers.find((m) => (m.name || '').trim().toLowerCase() === targetName)
        if (matchedMember) {
          leadId = matchedMember.id
          detectedAssigneeIds.add(leadId)
        }
      }
    }

    // 3. Fallback: plain text "lead: @Name" or "lead @Name"
    if (!leadId) {
      for (const m of sortedMembers) {
        if (!m.name) continue
        const escapedName = escapeRegExp(m.name)
        const nameRegex = new RegExp(`(?:lead\\s*(?::|is|will be))\\s*@?${escapedName}(?!\\w)`, 'i')
        if (nameRegex.test(plainText) || nameRegex.test(htmlContent)) {
          leadId = m.id
          detectedAssigneeIds.add(leadId)
          break
        }
      }
    }

    // 4. Also scan for any other @Name in text to add to assignees
    for (const m of sortedMembers) {
      if (!m.name) continue
      const escapedName = escapeRegExp(m.name)
      const mentionRegex = new RegExp(`@${escapedName}(?!\\w)`, 'i')
      if (mentionRegex.test(plainText) || mentionRegex.test(htmlContent)) {
        detectedAssigneeIds.add(m.id)
      }
    }

    const allAssignees = Array.from(detectedAssigneeIds)
    const assigneeIds = allAssignees.filter((id) => id !== leadId)

    // If no explicit lead but mentions exist, first mention is lead
    if (!leadId && allAssignees.length > 0) {
      leadId = allAssignees[0]
    }

    return {
      leadId,
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : leadId ? [leadId] : []
    }
  }

  /**
   * Extract literal email address from text.
   */
  public extractLiteralEmail(text: string): string | null {
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
   * Main async execution pipeline called by the BullMQ worker.
   */
  public async processMessage(chatMessageId: string): Promise<void> {
    const message = await this.chatRepo.getMessageById(chatMessageId)
    if (!message) {
      console.warn(`[BotOrchestrator] Message ${chatMessageId} not found`)
      return
    }

    const { projectId, organizationId, senderId, content, fileIds, mentionUserIds, linkedTaskId } =
      message as any

    // Strictly org-scoped bot user ID lookup
    const botUserId = await this.getBotUserIdForOrg(organizationId)

    // Idempotency check: If task is already linked, skip processing to prevent duplicate tasks
    if (linkedTaskId) {
      console.log(
        `[BotOrchestrator] Message ${chatMessageId} already linked to task ${linkedTaskId}. Skipping creation.`
      )
      await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.COMPLETED as any)
      return
    }

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

      // Fetch project, project members, and organization members for comprehensive member resolution
      const isValidId = (id: string) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)
      const project = isValidId(projectId)
        ? await pmClient.project.findUnique({ where: { id: projectId } }).catch(() => null)
        : null
      const projectMembers = isValidId(projectId)
        ? await pmClient.members.findMany({
            where: { projectId },
            include: { users: true }
          }).catch(() => [])
        : []
      const orgMembers = isValidId(organizationId)
        ? await pmClient.organizationMembers.findMany({
            where: { organizationId },
            include: { users: true }
          }).catch(() => [])
        : []

      const memberMap = new Map<string, any>()
      const memberNames: string[] = []

      // Populate from project members
      projectMembers.forEach((pm: any) => {
        const name = pm.users?.name || pm.uid
        const email = pm.users?.email || ''
        memberMap.set(pm.uid, { id: pm.uid, name, email })
        memberNames.push(`${name} (${email})`)
      })

      // Populate from organization members (fallback)
      orgMembers.forEach((om: any) => {
        if (!memberMap.has(om.uid)) {
          const name = om.users?.name || om.uid
          const email = om.users?.email || ''
          memberMap.set(om.uid, { id: om.uid, name, email })
          memberNames.push(`${name} (${email})`)
        }
      })

      const plainText = this.htmlToPlainText(content)
      const commandType = this.extractSlashCommand(plainText)

      // ─── MINIMUM CONTENT GUARD (Section 2) ──────────────────────────────────
      // Strip slash commands, bot mentions, and lead keywords to inspect core instructions
      const cleanedCoreText = plainText
        .replace(/^\s*\/(?:task|bug|email)\b/i, '')
        .replace(/@(?:bot|ai)\b/gi, '')
        .replace(/(?:lead\s*(?::|is|will be))\s*@?[^\s]+/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim()

      if (!cleanedCoreText || cleanedCoreText.split(/\s+/).filter(Boolean).length === 0) {
        const cmdName = commandType ? commandType.toLowerCase() : 'task'
        const clarificationReply = await this.chatRepo.createMessage({
          organizationId,
          projectId,
          senderId: botUserId,
          content: `<p>❓ Please provide instructions for the ${cmdName} (e.g. <code>/${commandType || 'Task'} @bot Write launch notes lead: @Name</code>).</p>`,
          mentionUserIds: [senderId],
          fileIds: [],
          commandType: (commandType || ChatCommandType.GENERAL) as any,
          status: ChatMessageStatus.COMPLETED as any,
          linkedTaskId: null,
          errorMessage: null,
          isBotReply: true
        })

        pusherTrigger('team-collab', `chat-message-${projectId}`, clarificationReply)
        await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.COMPLETED as any)
        return
      }

      const candidateUserIds = ((mentionUserIds as string[]) || []).filter((uid) => uid !== botUserId)

      const { leadId, assigneeIds } = this.extractLeadId({
        htmlContent: content,
        plainText,
        candidateMemberIds: candidateUserIds,
        members: Array.from(memberMap.values())
      })

      // Single combined LLM structured call (Section 7)
      let aiResult: any
      try {
        aiResult = await parseTaskWithGemini({
          rawText: plainText,
          commandHint: commandType as any,
          memberNames
        })
      } catch (aiErr: any) {
        console.error('[BotOrchestrator] AI parsing failed after retries:', aiErr?.message)
        const failureReply = await this.chatRepo.createMessage({
          organizationId,
          projectId,
          senderId: botUserId,
          content: `<p>❌ <strong>Error:</strong> AI service temporarily unavailable. Please retry your request.</p>`,
          mentionUserIds: [senderId],
          fileIds: [],
          commandType: (commandType || ChatCommandType.GENERAL) as any,
          status: ChatMessageStatus.FAILED as any,
          linkedTaskId: null,
          errorMessage: aiErr?.message || 'AI parsing error',
          isBotReply: true
        })

        pusherTrigger('team-collab', `chat-message-${projectId}`, failureReply)
        await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.FAILED as any, {
          errorMessage: aiErr?.message || 'AI parsing error'
        })
        return
      }

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

        // If no literal email, resolve from candidate member IDs or named mentions
        if (!targetEmail && candidateUserIds.length > 0) {
          const targetMember = memberMap.get(candidateUserIds[0])
          if (targetMember?.email) targetEmail = targetMember.email
        }

        // If still no target email, scan plain text / HTML for mentioned member name
        if (!targetEmail) {
          for (const m of memberMap.values()) {
            if (!m.name || !m.email) continue
            const escaped = escapeRegExp(m.name)
            const namePattern = new RegExp(`@?${escaped}(?!\\w)`, 'i')
            if (namePattern.test(plainText) || namePattern.test(content)) {
              targetEmail = m.email
              break
            }
          }
        }

        if (!targetEmail) {
          throw new Error('No valid recipient email address or mentioned user with email found.')
        }

        // Security logging for external recipients
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

        // Concise one-line success reply (Section 4)
        const botReply = await this.chatRepo.createMessage({
          organizationId,
          projectId,
          senderId: botUserId,
          content: `<p>✅ <strong>Email sent to ${targetEmail}</strong></p>`,
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

        let createdTaskId = linkedTaskId
        let createdTaskTitle = aiResult.title

        // Default dueDate (+7 days from now) so task is visible in default "This month" board views
        const defaultDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

        // Only create task if not already created
        if (!createdTaskId) {
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
              dueDate: defaultDueDate,
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
          createdTaskId = createdTask.id
          createdTaskTitle = createdTask.title

          await this.chatRepo.updateMessageStatus(chatMessageId, ChatMessageStatus.COMPLETED as any, {
            linkedTaskId: createdTaskId,
            commandType: (taskType === TaskType.BUG ? ChatCommandType.BUG : ChatCommandType.TASK) as any
          })
        }

        const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Technewity CRM'
        const taskUrl = genFrontendUrl(
          `${project?.organizationId}/project/${projectId}?mode=task&taskId=${createdTaskId}`
        )

        // In-app notifications & email dispatch
        const notifyTargetUserIds = Array.from(new Set([...effectiveAssignees, effectiveLeadId]))
        for (const targetUid of notifyTargetUserIds) {
          if (targetUid === senderId) continue

          await this.notificationRepo.createNotification({
            organizationId,
            userId: targetUid,
            type: 'TASK_ASSIGNED',
            title: `Assigned to ${taskType}: "${createdTaskTitle}"`,
            body: aiResult.rephrased_description.slice(0, 150),
            link: taskUrl
          })

          const targetMember = memberMap.get(targetUid)
          if (targetMember?.email) {
            await sendEmail({
              emails: [targetMember.email],
              subject: `[${appName}] New ${taskType} Assigned: "${createdTaskTitle}"`,
              html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2>You were assigned a new ${taskType.toLowerCase()} by AI Bot</h2>
                <p><strong>Title:</strong> ${createdTaskTitle}</p>
                <p><strong>Description:</strong> ${aiResult.rephrased_description}</p>
                <p><a href="${taskUrl}" style="background-color: #4f46e5; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block;">View Task</a></p>
              </div>`
            }).catch((e: any) => console.error('[BotOrchestrator Email Error]', e))
          }
        }

        // Concise one-line success reply (Section 4)
        const typeLabel = taskType === TaskType.BUG ? 'Bug' : 'Task'
        const botReply = await this.chatRepo.createMessage({
          organizationId,
          projectId,
          senderId: botUserId,
          content: `<p>✅ <strong>${typeLabel} created</strong> — <a href="${taskUrl}" class="text-indigo-600 underline font-semibold">View Task</a></p>`,
          mentionUserIds: [senderId, ...notifyTargetUserIds],
          fileIds: fileIds || [],
          commandType: (taskType === TaskType.BUG ? ChatCommandType.BUG : ChatCommandType.TASK) as any,
          status: ChatMessageStatus.COMPLETED as any,
          linkedTaskId: createdTaskId,
          errorMessage: null,
          isBotReply: true
        })

        pusherTrigger('team-collab', `chat-message-${projectId}`, botReply)
        return
      }

      // ─── Branch 3: UNCLEAR INTENT ─────────────────────────────────────────────
      const unclearReply = await this.chatRepo.createMessage({
        organizationId,
        projectId,
        senderId: botUserId,
        content: `<p>❓ I couldn't determine your intent. Please use <code>/Task</code>, <code>/Bug</code>, or <code>/Email</code> with your request.</p>`,
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

      try {
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
      } catch (replyErr) {
        console.error('[BotOrchestrator Fatal Reply Error]', replyErr)
      }
    }
  }
}
