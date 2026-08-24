import { ChatCommandType, ChatMessageStatus, TaskPriority, TaskType } from '@prisma/client'
import { ChatRepository, ensureBotUserForOrg, pmClient, SchedulerRepository } from '@database'
import TaskCreateService from '../task/create.service'
import StatsService from '../stats/index.service'
import { parseTaskWithGemini, TBotIntent } from './gemini.client'
import { AiUsageLogRepository } from '@database'
import { NotificationRepository } from '@database'
import { sendEmail } from '../../lib/email'
import { pusherTrigger } from '../../lib/pusher-server'
import { incrCache } from '../../lib/redis'
import { genFrontendUrl } from '../../lib/url'
import { publish } from '@event-bus'
import * as chrono from 'chrono-node'

const CHANNEL_SCHEDULER_CREATE = 'scheduler:create'

/**
 * Escapes all regular expression special characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface ParsedModifiers {
  priority: TaskPriority
  dueDate: Date
  dueDateIsExplicit: boolean
  points: number | null
  rawTags: string[]
  checklistItems: Array<{ title: string; order: number }>
  cleanedText: string
  warnings: string[]
}

export class BotOrchestratorService {
  public chatRepo: ChatRepository
  public taskCreateService: TaskCreateService
  public statsService: StatsService
  public schedulerRepo: SchedulerRepository
  public aiUsageRepo: AiUsageLogRepository
  public notificationRepo: NotificationRepository

  // In-memory cache for org-scoped bot user IDs
  private botUserCache: Map<string, string> = new Map()

  constructor() {
    this.chatRepo = new ChatRepository()
    this.taskCreateService = new TaskCreateService()
    this.statsService = new StatsService()
    this.schedulerRepo = new SchedulerRepository()
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
   * Updates message status in DB and immediately pushes the updated message via Pusher
   * so the frontend removes the 'Still working on it...' spinner in real-time without page refresh.
   */
  public async updateAndPushMessageStatus(
    projectId: string,
    chatMessageId: string,
    status: ChatMessageStatus,
    extra?: { linkedTaskId?: string; errorMessage?: string; commandType?: any }
  ) {
    const updated = await this.chatRepo.updateMessageStatus(chatMessageId, status as any, extra)
    if (updated && projectId) {
      pusherTrigger('team-collab', `chat-message-${projectId}`, updated)
    }
    return updated
  }

  /**
   * Extract explicit slash commands from text (/Task, /Bug, /Feature, /Improvement, /Report, /Schedule, /Email).
   */
  public extractSlashCommand(text: string): TBotIntent | null {
    const trimmed = text.trim()
    if (/^\/(?:task)\b/i.test(trimmed)) return 'TASK'
    if (/^\/(?:bug)\b/i.test(trimmed)) return 'BUG'
    if (/^\/(?:feature|newfeature)\b/i.test(trimmed)) return 'FEATURE'
    if (/^\/(?:improvement|improve|enhance)\b/i.test(trimmed)) return 'IMPROVEMENT'
    if (/^\/(?:report)\b/i.test(trimmed)) return 'REPORT'
    if (/^\/(?:schedule|recurring|cron)\b/i.test(trimmed)) return 'SCHEDULE'
    if (/^\/(?:email|mail)\b/i.test(trimmed)) return 'EMAIL'
    return null
  }

  /**
   * Converts TipTap / ProseMirror HTML into clean plain text for AI parsing.
   */
  public htmlToPlainText(html: string): string {
    if (!html) return ''
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<span[^>]*class="[^"]*mention[^"]*"[^>]*>(.*?)<\/span>/gi, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .trim()
  }

  /**
   * Generic modifier parser handling priority:, due:, points:, tags, and checklists uniformly.
   */
  public parseModifiers(text: string): ParsedModifiers {
    const warnings: string[] = []
    let cleaned = text

    // 1. Checklist extraction: lines starting with '- ', '* ', '[ ] ', or '1. '
    const checklistItems: Array<{ title: string; order: number }> = []
    const lines = cleaned.split('\n')
    const remainingLines: string[] = []

    let order = 0
    for (const line of lines) {
      const trimmed = line.trim()
      const match = trimmed.match(/^(?:[-*]\s+|\d+\.\s+|\[\s*\]\s+)(.+)$/)
      if (match && match[1]) {
        const itemTitle = match[1].trim()
        if (itemTitle) {
          checklistItems.push({ title: itemTitle, order })
          order++
          continue
        }
      }
      remainingLines.push(line)
    }
    cleaned = remainingLines.join(' ')

    // 2. Priority extraction: priority: urgent / high / normal / low
    let priority: TaskPriority = TaskPriority.NORMAL
    const priorityMatch = cleaned.match(/(?:priority|pri)\s*:\s*([a-zA-Z_-]+)/i)
    if (priorityMatch && priorityMatch[1]) {
      const rawVal = priorityMatch[1].trim().toUpperCase()
      if (rawVal === 'URGENT' || rawVal === 'CRITICAL') {
        priority = TaskPriority.URGENT
      } else if (rawVal === 'HIGH') {
        priority = TaskPriority.HIGH
      } else if (rawVal === 'NORMAL' || rawVal === 'MEDIUM') {
        priority = TaskPriority.NORMAL
      } else if (rawVal === 'LOW') {
        priority = TaskPriority.LOW
      } else {
        warnings.push(`Unrecognized priority "${priorityMatch[1]}", defaulted to NORMAL.`)
      }
      cleaned = cleaned.replace(priorityMatch[0], '')
    }

    // 3. Points extraction: points: 3 / pts: 5 / point: 2
    let points: number | null = null
    const pointsMatch = cleaned.match(/(?:points|point|pts)\s*:\s*([a-zA-Z0-9]+)/i)
    if (pointsMatch && pointsMatch[1]) {
      const parsedPts = parseInt(pointsMatch[1], 10)
      if (!isNaN(parsedPts)) {
        points = parsedPts
      } else {
        warnings.push(`Non-numeric points value "${pointsMatch[1]}" was ignored.`)
      }
      cleaned = cleaned.replace(pointsMatch[0], '')
    }

    // 4. Due date extraction: due: tomorrow / due: friday / due date: sep 15
    let dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Default +7 days
    let dueDateIsExplicit = false
    const dueMatch = cleaned.match(/(?:due\s*date|due|deadline)\s*:\s*([^,\n\r]+?)(?=(?:\s+(?:priority|pri|points|point|pts|lead|assign|to):|\s*#|\s*$))/i)
    if (dueMatch && dueMatch[1]) {
      const rawDateStr = dueMatch[1].trim()
      const parsedDate = chrono.parseDate(rawDateStr, new Date())
      if (parsedDate) {
        dueDate = parsedDate
        dueDateIsExplicit = true
      } else {
        warnings.push(`Could not parse due date "${rawDateStr}", defaulted to +7 days.`)
      }
      cleaned = cleaned.replace(dueMatch[0], '')
    }

    // 5. Hashtag extraction: #tagname
    const rawTags: string[] = []
    const tagMatches = cleaned.matchAll(/#([a-zA-Z0-9_-]+)/g)
    for (const m of tagMatches) {
      if (m[1]) {
        rawTags.push(m[1].toLowerCase())
      }
    }
    // Remove hashtags from core description text
    cleaned = cleaned.replace(/#([a-zA-Z0-9_-]+)/g, '')

    // Clean extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim()

    return {
      priority,
      dueDate,
      dueDateIsExplicit,
      points,
      rawTags: Array.from(new Set(rawTags)),
      checklistItems,
      cleanedText: cleaned,
      warnings
    }
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

    // 1. TipTap mention span with data-id right after "lead:" / "lead is" / "lead will be" / "assign:"
    const leadMentionRegex = /(?:lead\s*(?::|is|will be)|assign\s*:|to\s*:)\s*<span[^>]*data-id="([a-f0-9]+)"/i
    const match = htmlContent.match(leadMentionRegex)
    if (match && match[1]) {
      leadId = match[1]
      detectedAssigneeIds.add(leadId)
    }

    // 2. TipTap mention span with text: lead: <span class="mention">@Name</span>
    if (!leadId) {
      const spanNameRegex = /(?:lead\s*(?::|is|will be)|assign\s*:|to\s*:)\s*<span[^>]*class="[^"]*mention[^"]*"[^>]*>@?([^<]+)<\/span>/i
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
        const nameRegex = new RegExp(`(?:lead\\s*(?::|is|will be)|assign\\s*:|to\\s*:)\\s*@?${escapedName}(?!\\w)`, 'i')
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
    return (current ?? 0) <= limit
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
      await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any)
      return
    }

    try {
      await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.PROCESSING as any)

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
        await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any)
        return
      }

      // Fetch project, project members, organization members, and project tags
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
      const projectTags = isValidId(projectId)
        ? await pmClient.tag.findMany({ where: { projectId } }).catch(() => [])
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

      // ─── MINIMUM CONTENT GUARD ──────────────────────────────────────────────
      const cleanedCoreText = plainText
        .replace(/^\s*\/(?:task|bug|feature|newfeature|improvement|improve|enhance|report|schedule|recurring|cron|email|mail)\b/i, '')
        .replace(/@(?:bot|ai)\b/gi, '')
        .replace(/(?:lead\s*(?::|is|will be)|assign\s*:|to\s*:)\s*@?[^\s]+/gi, '')
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
        await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any)
        return
      }

      // Parse generic modifiers (priority, due, points, tags, checklists)
      const parsedModifiers = this.parseModifiers(cleanedCoreText)

      const candidateUserIds = ((mentionUserIds as string[]) || []).filter((uid) => uid !== botUserId)

      const { leadId, assigneeIds } = this.extractLeadId({
        htmlContent: content,
        plainText,
        candidateMemberIds: candidateUserIds,
        members: Array.from(memberMap.values())
      })

      // Tag resolution: case-insensitive match against existing project tags
      const matchedTagIds: string[] = []
      const unmatchedTags: string[] = []
      for (const rawTag of parsedModifiers.rawTags) {
        const matched = projectTags.find((t: any) => t.name.toLowerCase() === rawTag.toLowerCase())
        if (matched) {
          matchedTagIds.push(matched.id)
        } else {
          unmatchedTags.push(`#${rawTag}`)
        }
      }

      // Single combined LLM structured call
      let aiResult: any
      try {
        aiResult = await parseTaskWithGemini({
          rawText: parsedModifiers.cleanedText || plainText,
          commandHint: commandType,
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
        await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.FAILED as any, {
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

      const finalIntent = (commandType || aiResult.intent) as TBotIntent

      // ─── DISPATCH PATH 1: TASK-LIKE CREATION (/Task, /Bug, /Feature, /Improvement) ─
      if (
        finalIntent === 'TASK' ||
        finalIntent === 'BUG' ||
        finalIntent === 'FEATURE' ||
        finalIntent === 'IMPROVEMENT'
      ) {
        let taskType: TaskType = TaskType.TASK
        let commandPrismaType: ChatCommandType = ChatCommandType.TASK

        if (finalIntent === 'BUG') {
          taskType = TaskType.BUG
          commandPrismaType = ChatCommandType.BUG
        } else if (finalIntent === 'FEATURE') {
          taskType = TaskType.NEW_FEATURE
          commandPrismaType = ChatCommandType.TASK
        } else if (finalIntent === 'IMPROVEMENT') {
          taskType = TaskType.IMPROVEMENT
          commandPrismaType = ChatCommandType.TASK
        }

        await this.handleCreateTaskItem({
          taskType,
          commandPrismaType,
          organizationId,
          projectId,
          senderId,
          botUserId,
          chatMessageId,
          fileIds: fileIds || [],
          title: aiResult.title,
          description: aiResult.rephrased_description,
          leadId,
          assigneeIds,
          priority: parsedModifiers.priority,
          dueDate: parsedModifiers.dueDate,
          taskPoint: parsedModifiers.points,
          tagIds: matchedTagIds,
          unmatchedTags,
          checklistItems: parsedModifiers.checklistItems,
          warnings: parsedModifiers.warnings,
          memberMap,
          project,
          projectMembers
        })
        return
      }

      // ─── DISPATCH PATH 2: PROJECT REPORT (/Report) ───────────────────────────
      if (finalIntent === 'REPORT') {
        await this.handleReport({
          organizationId,
          projectId,
          senderId,
          botUserId,
          chatMessageId,
          plainText,
          content,
          reportDurationHint: aiResult.report_duration,
          memberMap,
          candidateUserIds,
          project
        })
        return
      }

      // ─── DISPATCH PATH 3: RECURRING SCHEDULE (/Schedule) ─────────────────────
      if (finalIntent === 'SCHEDULE') {
        await this.handleSchedule({
          organizationId,
          projectId,
          senderId,
          botUserId,
          chatMessageId,
          plainText,
          aiResult,
          candidateUserIds
        })
        return
      }

      // ─── DISPATCH PATH 4: EMAIL DISPATCH (/Email) ────────────────────────────
      if (finalIntent === 'EMAIL') {
        await this.handleEmail({
          organizationId,
          projectId,
          senderId,
          botUserId,
          chatMessageId,
          plainText,
          content,
          candidateUserIds,
          memberMap,
          aiResult,
          project
        })
        return
      }

      // ─── DISPATCH PATH 5: UNCLEAR INTENT ─────────────────────────────────────
      const unclearReply = await this.chatRepo.createMessage({
        organizationId,
        projectId,
        senderId: botUserId,
        content: `<p>❓ I couldn't determine your intent. Please use <code>/Task</code>, <code>/Bug</code>, <code>/Feature</code>, <code>/Improvement</code>, <code>/Report</code>, <code>/Schedule</code>, or <code>/Email</code>.</p>`,
        mentionUserIds: [senderId],
        fileIds: [],
        commandType: ChatCommandType.GENERAL as any,
        status: ChatMessageStatus.COMPLETED as any,
        linkedTaskId: null,
        errorMessage: null,
        isBotReply: true
      })

      pusherTrigger('team-collab', `chat-message-${projectId}`, unclearReply)
      await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any)
    } catch (error: any) {
      console.error('[BotOrchestrator Error]', error)
      const errorMsg = error?.message || 'An unexpected error occurred.'

      await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.FAILED as any, {
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

  /**
   * Consolidated Parameterized Handler for Task, Bug, Feature, and Improvement.
   */
  public async handleCreateTaskItem({
    taskType,
    commandPrismaType,
    organizationId,
    projectId,
    senderId,
    botUserId,
    chatMessageId,
    fileIds,
    title,
    description,
    leadId,
    assigneeIds,
    priority,
    dueDate,
    taskPoint,
    tagIds,
    unmatchedTags,
    checklistItems,
    warnings,
    memberMap,
    project,
    projectMembers
  }: {
    taskType: TaskType
    commandPrismaType: ChatCommandType
    organizationId: string
    projectId: string
    senderId: string
    botUserId: string
    chatMessageId: string
    fileIds: string[]
    title: string
    description: string
    leadId: string | null
    assigneeIds: string[]
    priority: TaskPriority
    dueDate: Date
    taskPoint: number | null
    tagIds: string[]
    unmatchedTags: string[]
    checklistItems: Array<{ title: string; order: number }>
    warnings: string[]
    memberMap: Map<string, any>
    project: any
    projectMembers: any[]
  }): Promise<void> {
    const isValidId = (id: string) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)
    const effectiveAssignees = assigneeIds.length > 0 ? assigneeIds : [senderId]
    const effectiveLeadId = leadId || effectiveAssignees[0]

    // Ensure assignees/lead are registered as project members
    for (const uid of effectiveAssignees) {
      if (isValidId(uid) && isValidId(projectId) && !projectMembers.some((pm: any) => pm.uid === uid)) {
        await pmClient.members
          .create({
            data: {
              projectId,
              uid,
              role: 'MEMBER' as any,
              createdAt: new Date(),
              createdBy: senderId
            }
          })
          .catch(() => null)
      }
    }

    // Create the task in the database
    const createdTask = await this.taskCreateService.createNewTask({
      uid: senderId,
      body: {
        id: undefined as any,
        title,
        desc: description,
        type: taskType,
        projectId,
        assigneeIds: effectiveAssignees,
        leadId: effectiveLeadId,
        fileIds: fileIds || [],
        priority,
        createdVia: 'BOT' as any,
        order: 0,
        dueDate,
        cover: null,
        startDate: null,
        plannedStartDate: null,
        plannedDueDate: null,
        visionId: null,
        taskStatusId: null,
        tagIds,
        parentTaskId: null,
        progress: 0,
        done: false,
        taskPoint,
        customFields: {},
        checklistDone: 0,
        checklistTodos: checklistItems.length,
        createdBy: senderId,
        createdAt: new Date(),
        updatedBy: null,
        updatedAt: null
      } as any
    })

    const createdTaskId = createdTask.id
    const createdTaskTitle = createdTask.title

    // Create TaskChecklist rows in MongoDB
    if (checklistItems.length > 0 && isValidId(createdTaskId)) {
      for (const item of checklistItems) {
        await pmClient.taskChecklist.create({
          data: {
            taskId: createdTaskId,
            title: item.title,
            order: item.order,
            done: false
          }
        }).catch((e: any) => console.error('[BotOrchestrator Checklist Error]', e))
      }
    }

    await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any, {
      linkedTaskId: createdTaskId,
      commandType: commandPrismaType as any
    })

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
        body: description.slice(0, 150),
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
            <p><strong>Priority:</strong> ${priority} | <strong>Due:</strong> ${dueDate.toISOString().split('T')[0]}</p>
            <p><strong>Description:</strong> ${description}</p>
            ${checklistItems.length > 0 ? `<p><strong>Checklist (${checklistItems.length} items):</strong></p><ul>${checklistItems.map(c => `<li>${c.title}</li>`).join('')}</ul>` : ''}
            <p><a href="${taskUrl}" style="background-color: #4f46e5; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block;">View Task</a></p>
          </div>`
        }).catch((e: any) => console.error('[BotOrchestrator Email Error]', e))
      }
    }

    // Build human-friendly label
    let typeLabel = 'Task'
    if (taskType === TaskType.BUG) typeLabel = 'Bug'
    else if (taskType === TaskType.NEW_FEATURE) typeLabel = 'Feature'
    else if (taskType === TaskType.IMPROVEMENT) typeLabel = 'Improvement'

    const metaNotes: string[] = []
    if (checklistItems.length > 0) metaNotes.push(`📋 ${checklistItems.length} checklist items`)
    if (unmatchedTags.length > 0) metaNotes.push(`🏷️ Unmatched tags: ${unmatchedTags.join(', ')}`)
    if (warnings.length > 0) metaNotes.push(`⚠️ ${warnings.join(' ')}`)

    const notesHtml = metaNotes.length > 0 ? ` <span class="text-xs text-gray-500">(${metaNotes.join(' · ')})</span>` : ''

    const botReply = await this.chatRepo.createMessage({
      organizationId,
      projectId,
      senderId: botUserId,
      content: `<p>✅ <strong>${typeLabel} created</strong> — <a href="${taskUrl}" class="text-indigo-600 underline font-semibold">View Task</a>${notesHtml}</p>`,
      mentionUserIds: [senderId, ...notifyTargetUserIds],
      fileIds: fileIds || [],
      commandType: commandPrismaType as any,
      status: ChatMessageStatus.COMPLETED as any,
      linkedTaskId: createdTaskId,
      errorMessage: null,
      isBotReply: true
    })

    pusherTrigger('team-collab', `chat-message-${projectId}`, botReply)
  }

  /**
   * Handler for /Report command: generates project stats and optionally emails them.
   */
  public async handleReport({
    organizationId,
    projectId,
    senderId,
    botUserId,
    chatMessageId,
    plainText,
    content,
    reportDurationHint,
    memberMap,
    candidateUserIds,
    project
  }: {
    organizationId: string
    projectId: string
    senderId: string
    botUserId: string
    chatMessageId: string
    plainText: string
    content: string
    reportDurationHint?: string
    memberMap: Map<string, any>
    candidateUserIds: string[]
    project: any
  }): Promise<void> {
    const isValidId = (id: string) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)

    // Compute duration string YYYY/MM/DD-YYYY/MM/DD
    const now = new Date()
    const isMonthly = /month/i.test(plainText) || reportDurationHint === 'monthly'
    let duration = ''

    if (isMonthly) {
      const sY = now.getFullYear()
      const sM = now.getMonth() + 1
      duration = `${sY}/${sM}/1-${sY}/${sM}/31`
    } else {
      // Default to weekly
      const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      duration = `${pastWeek.getFullYear()}/${pastWeek.getMonth() + 1}/${pastWeek.getDate()}-${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`
    }

    // Query tasks for completion counts and member breakdown
    const allTasks = isValidId(projectId)
      ? await pmClient.task.findMany({ where: { projectId } }).catch(() => [])
      : []

    const totalCount = allTasks.length
    const doneTasks = allTasks.filter((t: any) => t.done)
    const inProgressTasks = allTasks.filter((t: any) => !t.done && t.progress > 0)
    const todoTasks = allTasks.filter((t: any) => !t.done && t.progress === 0)

    // Member breakdown
    const memberCompletionMap = new Map<string, number>()
    for (const t of doneTasks) {
      for (const uid of t.assigneeIds) {
        memberCompletionMap.set(uid, (memberCompletionMap.get(uid) || 0) + 1)
      }
    }

    const memberBreakdownHtml = Array.from(memberMap.values())
      .map((m) => {
        const completed = memberCompletionMap.get(m.id) || 0
        return `<li><strong>${m.name}:</strong> ${completed} tasks completed</li>`
      })
      .join('')

    const reportHtml = `
      <div style="font-family: sans-serif; line-height: 1.6;">
        <h4 style="margin: 0 0 8px 0; color: #4f46e5;">📊 Project Progress Report (${isMonthly ? 'Monthly' : 'Weekly'})</h4>
        <p style="margin: 0 0 6px 0;"><strong>Summary:</strong> Total: <strong>${totalCount}</strong> | Completed: <strong style="color: #16a34a;">${doneTasks.length}</strong> | In Progress: <strong style="color: #2563eb;">${inProgressTasks.length}</strong> | TODO: <strong style="color: #dc2626;">${todoTasks.length}</strong></p>
        <ul style="margin: 6px 0; padding-left: 20px;">
          ${memberBreakdownHtml || '<li>No member activity recorded yet.</li>'}
        </ul>
      </div>
    `

    // Check if email dispatch requested
    let emailDispatchedTo: string | null = null
    if (/email|mail|send\s+to/i.test(plainText)) {
      let targetEmail = this.extractLiteralEmail(plainText)
      if (!targetEmail && candidateUserIds.length > 0) {
        const mem = memberMap.get(candidateUserIds[0])
        if (mem?.email) targetEmail = mem.email
      }
      if (!targetEmail) {
        for (const m of memberMap.values()) {
          if (!m.name || !m.email) continue
          const escaped = escapeRegExp(m.name)
          if (new RegExp(`@?${escaped}(?!\\w)`, 'i').test(plainText)) {
            targetEmail = m.email
            break
          }
        }
      }

      if (targetEmail) {
        await sendEmail({
          emails: [targetEmail],
          subject: `[${process.env.NEXT_PUBLIC_APP_NAME || 'Technewity CRM'}] Project Report: ${project?.name || 'Project'}`,
          html: reportHtml
        }).catch((e) => console.error('[Report Email Error]', e))
        emailDispatchedTo = targetEmail
      }
    }

    const emailNote = emailDispatchedTo ? `<p style="margin-top: 8px; font-size: 12px; color: #16a34a;">✉️ Report emailed to <strong>${emailDispatchedTo}</strong></p>` : ''

    const botReply = await this.chatRepo.createMessage({
      organizationId,
      projectId,
      senderId: botUserId,
      content: `${reportHtml}${emailNote}`,
      mentionUserIds: [senderId],
      fileIds: [],
      commandType: ChatCommandType.GENERAL as any,
      status: ChatMessageStatus.COMPLETED as any,
      linkedTaskId: null,
      errorMessage: null,
      isBotReply: true
    })

    pusherTrigger('team-collab', `chat-message-${projectId}`, botReply)
    await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any)
  }

  /**
   * Handler for /Schedule command: creates a server-side Scheduler rule.
   */
  public async handleSchedule({
    organizationId,
    projectId,
    senderId,
    botUserId,
    chatMessageId,
    plainText,
    aiResult,
    candidateUserIds
  }: {
    organizationId: string
    projectId: string
    senderId: string
    botUserId: string
    chatMessageId: string
    plainText: string
    aiResult: any
    candidateUserIds: string[]
  }): Promise<void> {
    // 1. Determine action type (SEND_REPORT or NOTIFY_OVERDUE)
    let actionType: 'SEND_REPORT' | 'NOTIFY_OVERDUE' = 'SEND_REPORT'
    if (/overdue|deadline|pending/i.test(plainText)) {
      actionType = 'NOTIFY_OVERDUE'
    } else if (aiResult.schedule_action_type) {
      actionType = aiResult.schedule_action_type
    }

    // 2. Parse frequency (mon, tue, wed, thu, fri, sat, sun, day, weekday, hour, minute)
    let every = 'mon'
    const lower = plainText.toLowerCase()
    if (lower.includes('monday') || lower.includes('mon')) every = 'mon'
    else if (lower.includes('tuesday') || lower.includes('tue')) every = 'tue'
    else if (lower.includes('wednesday') || lower.includes('wed')) every = 'wed'
    else if (lower.includes('thursday') || lower.includes('thu')) every = 'thu'
    else if (lower.includes('friday') || lower.includes('fri')) every = 'fri'
    else if (lower.includes('saturday') || lower.includes('sat')) every = 'sat'
    else if (lower.includes('sunday') || lower.includes('sun')) every = 'sun'
    else if (lower.includes('weekday')) every = 'weekday'
    else if (lower.includes('every day') || lower.includes('daily')) every = 'day'
    else if (lower.includes('every hour')) every = 'hour'
    else if (lower.includes('every minute')) every = 'minute'

    // 3. Parse time: e.g. 9am, 10:30am, 2pm
    let hour = 9
    let minute = 0
    let period: 'am' | 'pm' = 'am'

    const timeMatch = plainText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10)
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0
      period = timeMatch[3].toLowerCase() as 'am' | 'pm'
    }

    const triggerConfig = {
      every,
      at: { hour, minute, period }
    }

    const actionConfig = {
      group: 'notification',
      type: actionType,
      config: {
        type: actionType,
        title: actionType === 'SEND_REPORT' ? 'Scheduled Project Report' : 'Overdue Tasks Alert',
        content: actionType === 'SEND_REPORT' ? 'Automated weekly progress report' : 'Please review overdue tasks',
        to: candidateUserIds.length > 0 ? candidateUserIds : ['ALL']
      }
    }

    // Create Scheduler row in database
    const createdScheduler = await pmClient.scheduler.create({
      data: {
        organizationId,
        projectId,
        cronId: null,
        trigger: triggerConfig,
        action: actionConfig,
        createdBy: senderId,
        createdAt: new Date(),
        updatedBy: null,
        updatedAt: null
      }
    })

    // Publish to Redis so task-runner instantiates the cron job immediately
    try {
      publish(CHANNEL_SCHEDULER_CREATE, createdScheduler)
    } catch (pubErr) {
      console.warn('[Scheduler Publish Warning]', pubErr)
    }

    const readableAction = actionType === 'SEND_REPORT' ? 'Weekly Project Report' : 'Overdue Tasks Notification'
    const botReply = await this.chatRepo.createMessage({
      organizationId,
      projectId,
      senderId: botUserId,
      content: `<p>⏰ <strong>Scheduled Action Created:</strong> <code>${readableAction}</code> runs <strong>every ${every}</strong> at <strong>${hour}:${minute < 10 ? '0' + minute : minute} ${period.toUpperCase()}</strong>.</p>`,
      mentionUserIds: [senderId],
      fileIds: [],
      commandType: ChatCommandType.GENERAL as any,
      status: ChatMessageStatus.COMPLETED as any,
      linkedTaskId: null,
      errorMessage: null,
      isBotReply: true
    })

    pusherTrigger('team-collab', `chat-message-${projectId}`, botReply)
    await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any)
  }

  /**
   * Handler for /Email command: dispatches formatted email.
   */
  public async handleEmail({
    organizationId,
    projectId,
    senderId,
    botUserId,
    chatMessageId,
    plainText,
    content,
    candidateUserIds,
    memberMap,
    aiResult,
    project
  }: {
    organizationId: string
    projectId: string
    senderId: string
    botUserId: string
    chatMessageId: string
    plainText: string
    content: string
    candidateUserIds: string[]
    memberMap: Map<string, any>
    aiResult: any
    project: any
  }): Promise<void> {
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
    await this.updateAndPushMessageStatus(projectId, chatMessageId, ChatMessageStatus.COMPLETED as any, {
      commandType: ChatCommandType.EMAIL as any
    })
  }
}
