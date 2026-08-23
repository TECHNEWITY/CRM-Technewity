import { BotOrchestratorService, escapeRegExp } from '../BotOrchestratorService'
import * as geminiClient from '../gemini.client'
import * as emailLib from '../../../lib/email'
import * as pusherLib from '../../../lib/pusher-server'
import * as eventBusLib from '@event-bus'
import { pmClient } from '@database'
import { TaskPriority, TaskType } from '@prisma/client'

jest.mock('../gemini.client', () => ({
  ...jest.requireActual('../gemini.client'),
  parseTaskWithGemini: jest.fn()
}))

jest.mock('../../../lib/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ id: 'mock-email-id' })
}))

jest.mock('../../../lib/pusher-server', () => ({
  pusherTrigger: jest.fn()
}))

jest.mock('@event-bus', () => ({
  publish: jest.fn()
}))

const MOCK_ORG_ID = '6a6ae824f587e315ef597234'
const MOCK_PROJECT_ID = '6a86edc41f82be8f2ade7888'
const MOCK_SENDER_ID = '6a6ae804f587e315ef597233'
const MOCK_VIVEK_ID = '6a6aecac0ee18af442cea6b8'
const MOCK_BOT_ID = '6a8ac000000000000000000a'

describe('BotOrchestratorService Master Comprehensive Test Suite', () => {
  let orchestrator: BotOrchestratorService

  beforeEach(() => {
    jest.clearAllMocks()
    orchestrator = new BotOrchestratorService()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 1. DETERMINISTIC PARSING & REGEX SAFETY
  // ───────────────────────────────────────────────────────────────────────────
  describe('Deterministic Parsing & Regex Safety', () => {
    it('should extract all slash commands properly (/Task, /Bug, /Feature, /Improvement, /Report, /Schedule, /Email)', () => {
      expect(orchestrator.extractSlashCommand('/Task @bot build blog')).toBe('TASK')
      expect(orchestrator.extractSlashCommand('/Bug @bot login button is broken')).toBe('BUG')
      expect(orchestrator.extractSlashCommand('/Feature @bot dark mode switch')).toBe('FEATURE')
      expect(orchestrator.extractSlashCommand('/Improvement @bot optimize speed')).toBe('IMPROVEMENT')
      expect(orchestrator.extractSlashCommand('/Report @bot weekly summary')).toBe('REPORT')
      expect(orchestrator.extractSlashCommand('/Schedule @bot send report every monday at 9am')).toBe('SCHEDULE')
      expect(orchestrator.extractSlashCommand('/Email @bot mail the report to @user')).toBe('EMAIL')
      expect(orchestrator.extractSlashCommand('@bot just some text')).toBeNull()
    })

    it('should convert html to plain text cleanly', () => {
      const html = '<p>Hello <strong>World</strong><br/>Line 2</p>'
      expect(orchestrator.htmlToPlainText(html)).toContain('Hello World')
    })

    it('should extract literal email from text', () => {
      expect(orchestrator.extractLiteralEmail('Send this to test@example.com please')).toBe(
        'test@example.com'
      )
      expect(orchestrator.extractLiteralEmail('No email here')).toBeNull()
    })

    it('should NOT crash on member names with regex special characters (parentheses, periods)', () => {
      expect(() => escapeRegExp('Alex (Dev)')).not.toThrow()
      expect(escapeRegExp('Alex (Dev)')).toBe('Alex \\(Dev\\)')
      expect(escapeRegExp('Dr. Smith [Admin]')).toBe('Dr\\. Smith \\[Admin\\]')

      const result = orchestrator.extractLeadId({
        htmlContent: '<p>lead: @Alex (Dev) please review</p>',
        plainText: 'lead: @Alex (Dev) please review',
        candidateMemberIds: ['user-alex', 'user-other'],
        members: [
          { id: 'user-alex', name: 'Alex (Dev)', email: 'alex@technewity.ai' },
          { id: 'user-other', name: 'Other User', email: 'other@technewity.ai' }
        ]
      })

      expect(result.leadId).toBe('user-alex')
      expect(result.assigneeIds).toEqual(['user-other'])
    })

    it('should correctly assign longer name ("Omkar") and NOT falsely match shorter substring ("Om")', () => {
      const members = [
        { id: 'user-om', name: 'Om', email: 'om@technewity.ai' },
        { id: 'user-omkar', name: 'Omkar', email: 'omkar@technewity.ai' }
      ]

      const result = orchestrator.extractLeadId({
        htmlContent: '<p>/Task @bot build recipe module lead: @Omkar</p>',
        plainText: '/Task @bot build recipe module lead: @Omkar',
        candidateMemberIds: [],
        members
      })

      expect(result.leadId).toBe('user-omkar')
    })

    it('should resolve space-separated member name ("VIVEK PANDEY") even when candidateMemberIds is empty', () => {
      const members = [
        { id: MOCK_VIVEK_ID, name: 'VIVEK PANDEY', email: 'vp983351@gmail.com' },
        { id: MOCK_SENDER_ID, name: 'sanket', email: 'snket2005d@gmail.com' }
      ]

      const result = orchestrator.extractLeadId({
        htmlContent: '<p>/Task @bot Write blog post for product launch. lead: <span class="mention">@VIVEK PANDEY</span></p>',
        plainText: '/Task @bot Write blog post for product launch. lead: @VIVEK PANDEY',
        candidateMemberIds: [],
        members
      })

      expect(result.leadId).toBe(MOCK_VIVEK_ID)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. GENERIC MODIFIER PARSER
  // ───────────────────────────────────────────────────────────────────────────
  describe('Generic Modifier Parser (priority:, due:, points:, tags, checklists)', () => {
    it('should parse priority: urgent, high, normal, low and handle unrecognized gracefully', () => {
      const urgentRes = orchestrator.parseModifiers('Fix checkout bug priority: urgent')
      expect(urgentRes.priority).toBe(TaskPriority.URGENT)

      const highRes = orchestrator.parseModifiers('Build landing page pri: high')
      expect(highRes.priority).toBe(TaskPriority.HIGH)

      const lowRes = orchestrator.parseModifiers('Refactor legacy css priority: low')
      expect(lowRes.priority).toBe(TaskPriority.LOW)

      const invalidRes = orchestrator.parseModifiers('Design banner priority: super-critical')
      expect(invalidRes.priority).toBe(TaskPriority.NORMAL)
      expect(invalidRes.warnings.length).toBeGreaterThan(0)
    })

    it('should parse natural due dates with chrono-node and fallback to +7d if absent', () => {
      const dueRes = orchestrator.parseModifiers('Launch newsletter due: tomorrow')
      expect(dueRes.dueDateIsExplicit).toBe(true)
      expect(dueRes.dueDate).toBeInstanceOf(Date)

      const noDueRes = orchestrator.parseModifiers('Generic task without due date')
      expect(noDueRes.dueDateIsExplicit).toBe(false)
      expect(noDueRes.dueDate.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
    })

    it('should parse points: 3 / pts: 5 and ignore non-numeric values gracefully', () => {
      const ptsRes = orchestrator.parseModifiers('Refactor auth service points: 5')
      expect(ptsRes.points).toBe(5)

      const nonNumRes = orchestrator.parseModifiers('Design mockup pts: invalid')
      expect(nonNumRes.points).toBeNull()
      expect(nonNumRes.warnings.length).toBeGreaterThan(0)
    })

    it('should parse checklist lines starting with - or *', () => {
      const input = `Create product launch plan
- Draft outline
- Review copy
* Finalize graphics`

      const res = orchestrator.parseModifiers(input)
      expect(res.checklistItems).toHaveLength(3)
      expect(res.checklistItems[0].title).toBe('Draft outline')
      expect(res.checklistItems[1].title).toBe('Review copy')
      expect(res.checklistItems[2].title).toBe('Finalize graphics')
    })

    it('should extract #hashtags cleanly from text', () => {
      const res = orchestrator.parseModifiers('Build auth flow #backend #security')
      expect(res.rawTags).toContain('backend')
      expect(res.rawTags).toContain('security')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. MINIMUM CONTENT GUARD
  // ───────────────────────────────────────────────────────────────────────────
  describe('Minimum Content Guard', () => {
    it('should NOT create a Task and should post a clarification reply when message is empty', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000001',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Task @bot ',
        mentionUserIds: [],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue(MOCK_BOT_ID)
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask')
      const createReplySpy = jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'reply-clarify' } as any)

      await orchestrator.processMessage('6a8ad0000000000000000001')

      expect(createNewTaskSpy).not.toHaveBeenCalled()
      expect(createReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isBotReply: true,
          content: expect.stringContaining('Please provide instructions for the task')
        })
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. NEW COMMANDS: /Feature and /Improvement
  // ───────────────────────────────────────────────────────────────────────────
  describe('New Commands: /Feature and /Improvement', () => {
    it('Flow: /Feature creates a NEW_FEATURE task with priority, points, and checklist', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000010',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Feature @bot Add Dark Mode switch priority: high points: 3 #ui\n- Create toggle component\n- Update theme store',
        mentionUserIds: [],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue(MOCK_BOT_ID)
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)
      jest.spyOn(orchestrator.aiUsageRepo, 'logUsage').mockResolvedValue(null as any)

      jest.spyOn(pmClient.tag, 'findMany').mockResolvedValue([
        { id: 'tag-ui-123', name: 'UI', color: '#6366f1', projectId: MOCK_PROJECT_ID }
      ] as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'FEATURE',
        title: 'Add Dark Mode Switch',
        rephrased_description: 'Implement dark mode toggle in user settings.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask').mockResolvedValue({
        id: '6a8ad0000000000000000011',
        title: 'Add Dark Mode Switch'
      } as any)
      const createChecklistSpy = jest.spyOn(pmClient.taskChecklist, 'create').mockResolvedValue({} as any)

      await orchestrator.processMessage('6a8ad0000000000000000010')

      expect(createNewTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            type: TaskType.NEW_FEATURE,
            priority: TaskPriority.HIGH,
            taskPoint: 3,
            tagIds: ['tag-ui-123'],
            checklistTodos: 2
          })
        })
      )
      expect(createChecklistSpy).toHaveBeenCalledTimes(2)
    })

    it('Flow: /Improvement creates an IMPROVEMENT task', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000020',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Improvement @bot Cache task query in redis',
        mentionUserIds: [],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue(MOCK_BOT_ID)
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)
      jest.spyOn(orchestrator.aiUsageRepo, 'logUsage').mockResolvedValue(null as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'IMPROVEMENT',
        title: 'Cache Task Query in Redis',
        rephrased_description: 'Improve dashboard response time by caching task queries.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask').mockResolvedValue({
        id: '6a8ad0000000000000000021',
        title: 'Cache Task Query in Redis'
      } as any)

      await orchestrator.processMessage('6a8ad0000000000000000020')

      expect(createNewTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            type: TaskType.IMPROVEMENT
          })
        })
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. /Report COMMAND
  // ───────────────────────────────────────────────────────────────────────────
  describe('/Report Command', () => {
    it('should generate project report summary and send email if requested', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000030',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Report @bot weekly summary email to @VIVEK PANDEY',
        mentionUserIds: [],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue(MOCK_BOT_ID)
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)
      jest.spyOn(orchestrator.aiUsageRepo, 'logUsage').mockResolvedValue(null as any)

      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([
        { uid: MOCK_VIVEK_ID, users: { name: 'VIVEK PANDEY', email: 'vp983351@gmail.com' } }
      ] as any)

      jest.spyOn(pmClient.task, 'findMany').mockResolvedValue([
        { id: 't1', done: true, progress: 100, assigneeIds: [MOCK_VIVEK_ID] },
        { id: 't2', done: false, progress: 50, assigneeIds: [MOCK_VIVEK_ID] }
      ] as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'REPORT',
        title: 'Weekly Progress Report',
        rephrased_description: 'Generate weekly project progress report.',
        report_duration: 'weekly'
      })

      const replySpy = jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'report-reply' } as any)

      await orchestrator.processMessage('6a8ad0000000000000000030')

      expect(emailLib.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: ['vp983351@gmail.com']
        })
      )
      expect(replySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isBotReply: true,
          content: expect.stringContaining('Project Progress Report')
        })
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 6. /Schedule COMMAND (Server-Side Cron Engine)
  // ───────────────────────────────────────────────────────────────────────────
  describe('/Schedule Command (Server-Side Cron Scheduler)', () => {
    it('should parse recurring intent, create a Scheduler record in DB, and publish to Redis', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000040',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Schedule @bot send weekly report every monday at 9am',
        mentionUserIds: [],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue(MOCK_BOT_ID)
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)
      jest.spyOn(orchestrator.aiUsageRepo, 'logUsage').mockResolvedValue(null as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'SCHEDULE',
        title: 'Weekly Report Schedule',
        rephrased_description: 'Schedule automated weekly report every Monday at 9am.',
        schedule_action_type: 'SEND_REPORT',
        schedule_every: 'mon'
      })

      const createSchedulerSpy = jest.spyOn(pmClient.scheduler, 'create').mockResolvedValue({
        id: 'sched-123',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        trigger: { every: 'mon', at: { hour: 9, minute: 0, period: 'am' } },
        action: { group: 'notification', type: 'SEND_REPORT' }
      } as any)

      const replySpy = jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'sched-reply' } as any)

      await orchestrator.processMessage('6a8ad0000000000000000040')

      expect(createSchedulerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: MOCK_PROJECT_ID,
            trigger: expect.objectContaining({
              every: 'mon',
              at: { hour: 9, minute: 0, period: 'am' }
            }),
            action: expect.objectContaining({
              group: 'notification',
              type: 'SEND_REPORT'
            })
          })
        })
      )

      expect(eventBusLib.publish).toHaveBeenCalledWith(
        'scheduler:create',
        expect.objectContaining({ id: 'sched-123' })
      )

      expect(replySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isBotReply: true,
          content: expect.stringContaining('Scheduled Action Created')
        })
      )
    })
  })
})
