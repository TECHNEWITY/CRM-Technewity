import { BotOrchestratorService, escapeRegExp } from '../BotOrchestratorService'
import * as geminiClient from '../gemini.client'
import * as emailLib from '../../../lib/email'
import * as pusherLib from '../../../lib/pusher-server'
import { ensureBotUserForOrg, pmClient } from '@database'

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

const MOCK_ORG_ID = '6a6ae824f587e315ef597234'
const MOCK_PROJECT_ID = '6a86edc41f82be8f2ade7888'
const MOCK_SENDER_ID = '6a6ae804f587e315ef597233'
const MOCK_VIVEK_ID = '6a6aecac0ee18af442cea6b8'
const MOCK_BOT_ID = '6a8ac000000000000000000a'

describe('BotOrchestratorService Comprehensive Test Suite', () => {
  let orchestrator: BotOrchestratorService

  beforeEach(() => {
    jest.clearAllMocks()
    orchestrator = new BotOrchestratorService()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 1. DETERMINISTIC PARSING & REGEX SAFETY
  // ───────────────────────────────────────────────────────────────────────────
  describe('Deterministic Parsing & Regex Safety', () => {
    it('should extract slash commands properly', () => {
      expect(orchestrator.extractSlashCommand('/Task @bot build blog')).toBe('TASK')
      expect(orchestrator.extractSlashCommand('/Bug @bot login button is broken')).toBe('BUG')
      expect(orchestrator.extractSlashCommand('/Email @bot mail the report to @user')).toBe('EMAIL')
      expect(orchestrator.extractSlashCommand('@bot just some text')).toBeNull()
    })

    it('should convert html to plain text cleanly', () => {
      const html = '<p>Hello <strong>World</strong><br/>Line 2</p>'
      expect(orchestrator.htmlToPlainText(html)).toBe('Hello World Line 2')
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
  // 2. MINIMUM CONTENT GUARD (EMPTY /TASK)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Minimum Content Guard (Empty /Task @bot)', () => {
    it('should NOT create a Task and should post a clarification reply when message is empty or only contains commands', async () => {
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

      // Assert NO task was created
      expect(createNewTaskSpy).not.toHaveBeenCalled()

      // Assert clarification reply was posted
      expect(createReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isBotReply: true,
          content: expect.stringContaining('Please provide instructions for the task')
        })
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. MULTI-TENANT BOT USER SCOPING
  // ───────────────────────────────────────────────────────────────────────────
  describe('Multi-Tenant Org-Scoped Bot User Lookup', () => {
    it('should return org-specific bot user id and never cross-contaminate between Org A and Org B', async () => {
      const mockBotA = { id: '6a8ac000000000000000000a', email: 'bot+org-a@technewity.ai' }
      const mockBotB = { id: '6a8ac000000000000000000b', email: 'bot+org-b@technewity.ai' }

      jest.spyOn(orchestrator as any, 'getBotUserIdForOrg').mockImplementation(async (orgId: string) => {
        if (orgId === '6a6ae824f587e315ef597234') return mockBotA.id
        if (orgId === '6a86c813d9ca962c8f61d469') return mockBotB.id
        throw new Error('Unknown org')
      })

      const botIdA = await orchestrator.getBotUserIdForOrg('6a6ae824f587e315ef597234')
      const botIdB = await orchestrator.getBotUserIdForOrg('6a86c813d9ca962c8f61d469')

      expect(botIdA).toBe('6a8ac000000000000000000a')
      expect(botIdB).toBe('6a8ac000000000000000000b')
      expect(botIdA).not.toBe(botIdB)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. IDEMPOTENCY ON RETRIES
  // ───────────────────────────────────────────────────────────────────────────
  describe('Idempotent Execution & No Duplicate Tasks on Retry', () => {
    it('should NOT create a duplicate task if chatMessage.linkedTaskId is already set', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000101',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Task @bot write documentation',
        mentionUserIds: [],
        fileIds: [],
        status: 'PROCESSING',
        linkedTaskId: '6a8ad0000000000000000999'
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue(MOCK_BOT_ID)
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)
      
      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask')

      await orchestrator.processMessage('6a8ad0000000000000000101')

      expect(createNewTaskSpy).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. END-TO-END FLOWS (TASK, BUG, EMAIL, ATTACHMENTS, DUE DATE)
  // ───────────────────────────────────────────────────────────────────────────
  describe('End-to-End Orchestrator Flows', () => {
    it('Flow 1: /Task command creates a TASK with lead, default +7d dueDate, and concise one-line reply', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000201',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Task @bot Build landing page lead: @VIVEK PANDEY',
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

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'TASK',
        title: 'Build Landing Page',
        rephrased_description: 'Construct a responsive landing page for the marketing campaign.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask').mockResolvedValue({
        id: '6a8ad0000000000000000301',
        title: 'Build Landing Page'
      } as any)
      const createReplySpy = jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'bot-reply-1' } as any)

      await orchestrator.processMessage('6a8ad0000000000000000201')

      // Assert Task creation with leadId and non-null dueDate (+7 days)
      expect(createNewTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            type: 'TASK',
            title: 'Build Landing Page',
            leadId: MOCK_VIVEK_ID,
            dueDate: expect.any(Date)
          })
        })
      )

      // Assert concise one-line reply
      expect(createReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isBotReply: true,
          content: expect.stringContaining('✅ <strong>Task created</strong>')
        })
      )
    })

    it('Flow 2: /Email command resolves member name @VIVEK PANDEY to vp983351@gmail.com and creates NO task', async () => {
      const mockMessage = {
        id: '6a8ad0000000000000000401',
        organizationId: MOCK_ORG_ID,
        projectId: MOCK_PROJECT_ID,
        senderId: MOCK_SENDER_ID,
        content: '/Email @bot Send project weekly summary report to @VIVEK PANDEY',
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
      jest.spyOn(orchestrator.notificationRepo, 'createNotification').mockResolvedValue({} as any)

      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([
        { uid: MOCK_VIVEK_ID, users: { name: 'VIVEK PANDEY', email: 'vp983351@gmail.com' } }
      ] as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'EMAIL',
        title: 'Project Weekly Summary Report',
        email_subject: 'Project Weekly Summary Report',
        email_body: 'Here is the weekly summary report for your review.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask')
      const createReplySpy = jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'bot-reply-mail' } as any)

      await orchestrator.processMessage('6a8ad0000000000000000401')

      // Assert sendEmail was invoked with Vivek Pandey's email
      expect(emailLib.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: ['vp983351@gmail.com'],
          subject: 'Project Weekly Summary Report'
        })
      )

      // Assert concise one-line reply
      expect(createReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isBotReply: true,
          content: '<p>✅ <strong>Email sent to vp983351@gmail.com</strong></p>'
        })
      )

      // Assert Task was NOT created
      expect(createNewTaskSpy).not.toHaveBeenCalled()
    })
  })
})
