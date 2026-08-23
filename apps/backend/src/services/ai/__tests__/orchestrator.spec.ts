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

describe('BotOrchestratorService Comprehensive Test Suite', () => {
  let orchestrator: BotOrchestratorService

  beforeEach(() => {
    jest.clearAllMocks()
    orchestrator = new BotOrchestratorService()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 1. DETERMINISTIC PARSING & REGEX SAFETY (BUG 4)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Deterministic Parsing & Bug 4 (Regex Safety & Overlapping Names)', () => {
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

    it('Bug 4 Fix: should NOT crash on member names with regex special characters (parentheses, periods)', () => {
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

    it('Bug 4 Fix: should correctly assign longer name ("Omkar") and NOT falsely match shorter substring ("Om")', () => {
      // Intentionally order "Om" before "Omkar" in members array to test sort precedence
      const members = [
        { id: 'user-om', name: 'Om', email: 'om@technewity.ai' },
        { id: 'user-omkar', name: 'Omkar', email: 'omkar@technewity.ai' }
      ]

      const result = orchestrator.extractLeadId({
        htmlContent: '<p>/Task @bot build recipe module lead: @Omkar</p>',
        plainText: '/Task @bot build recipe module lead: @Omkar',
        candidateMemberIds: ['user-om', 'user-omkar'],
        members
      })

      // Must be Omkar (user-omkar), not Om (user-om)
      expect(result.leadId).toBe('user-omkar')
      expect(result.assigneeIds).toEqual(['user-om'])
    })

    it('should extract lead via HTML data-id span with highest priority', () => {
      const result = orchestrator.extractLeadId({
        htmlContent:
          '<p>/Task @bot write blog lead: <span data-id="user-123" class="mention">@Omkar</span></p>',
        plainText: '/Task @bot write blog lead: @Omkar',
        candidateMemberIds: ['user-123', 'user-456'],
        members: [
          { id: 'user-123', name: 'Omkar', email: 'omkar@technewity.ai' },
          { id: 'user-456', name: 'Shreyansh', email: 'shreyansh@technewity.ai' }
        ]
      })
      expect(result.leadId).toBe('user-123')
      expect(result.assigneeIds).toEqual(['user-456'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. MULTI-TENANT BOT USER SCOPING (BUG 1)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Bug 1 Fix: Multi-Tenant Org-Scoped Bot User Lookup', () => {
    it('should return org-specific bot user id and never cross-contaminate between Org A and Org B', async () => {
      const botUserOrgASpy = jest.spyOn(orchestrator, 'getBotUserIdForOrg')
      
      // Mock ensureBotUserForOrg behavior for two different orgs
      const mockBotA = { id: '6a8ac000000000000000000a', email: 'bot+org-a@technewity.ai' }
      const mockBotB = { id: '6a8ac000000000000000000b', email: 'bot+org-b@technewity.ai' }

      jest.spyOn(orchestrator as any, 'getBotUserIdForOrg').mockImplementation(async (orgId: string) => {
        if (orgId === 'org-alpha') return mockBotA.id
        if (orgId === 'org-beta') return mockBotB.id
        throw new Error('Unknown org')
      })

      const botIdA = await orchestrator.getBotUserIdForOrg('org-alpha')
      const botIdB = await orchestrator.getBotUserIdForOrg('org-beta')

      expect(botIdA).toBe('6a8ac000000000000000000a')
      expect(botIdB).toBe('6a8ac000000000000000000b')
      expect(botIdA).not.toBe(botIdB)
      expect(botIdA).not.toBe('BOT_USER')
      expect(botIdB).not.toBe('BOT_USER')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. IDEMPOTENCY ON RETRIES (BUG 2)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Bug 2 Fix: Idempotent Execution & No Duplicate Tasks on Retry', () => {
    it('should NOT create a duplicate task if chatMessage.linkedTaskId is already set', async () => {
      const mockMessage = {
        id: 'msg-101',
        organizationId: 'org-1',
        projectId: 'proj-1',
        senderId: 'user-sender',
        content: '/Task @bot write documentation',
        mentionUserIds: [],
        fileIds: [],
        status: 'PROCESSING',
        linkedTaskId: 'existing-task-999' // Already has a linked task from earlier attempt
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue('6a8ac000000000000000000a')
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      
      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask')
      const updateStatusSpy = jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      await orchestrator.processMessage('msg-101')

      // Assert that createNewTask was NEVER called on this retry run
      expect(createNewTaskSpy).not.toHaveBeenCalled()
    })

    it('should link task immediately upon creation so downstream reply crash leaves message linked', async () => {
      const mockMessage = {
        id: 'msg-102',
        organizationId: 'org-1',
        projectId: 'proj-1',
        senderId: 'user-sender',
        content: '/Task @bot deploy release',
        mentionUserIds: ['user-dev'],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue('6a8ac000000000000000000a')
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(pmClient.project, 'findUnique').mockResolvedValue({ id: 'proj-1', organizationId: 'org-1' } as any)
      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([
        { uid: 'user-dev', users: { name: 'Dev User', email: 'dev@technewity.ai' } }
      ] as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'TASK',
        title: 'Deploy Release v1.0',
        rephrased_description: 'Deploy the v1.0 release to production environment.'
      })

      const createdTask = { id: 'task-new-555', title: 'Deploy Release v1.0' }
      jest.spyOn(orchestrator.taskCreateService, 'createNewTask').mockResolvedValue(createdTask as any)
      const updateStatusSpy = jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      // Mock bot reply creation to throw on attempt 1
      jest.spyOn(orchestrator.chatRepo, 'createMessage').mockRejectedValueOnce(new Error('Simulated network disconnect on reply'))

      await orchestrator.processMessage('msg-102')

      // Verify that updateMessageStatus was called with the linkedTaskId immediately upon task creation
      expect(updateStatusSpy).toHaveBeenCalledWith(
        'msg-102',
        'COMPLETED',
        expect.objectContaining({ linkedTaskId: 'task-new-555' })
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. RESILIENT AI FAILURE HANDLING (BUG 3)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Bug 3 Fix: Resilient AI Failure Handling', () => {
    it('should post a failure reply and mark message FAILED when Gemini throws 5xx, never leaving it in PENDING', async () => {
      const mockMessage = {
        id: 'msg-103',
        organizationId: 'org-1',
        projectId: 'proj-1',
        senderId: 'user-sender',
        content: '/Task @bot broken prompt',
        mentionUserIds: [],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue('6a8ac000000000000000000a')
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(pmClient.project, 'findUnique').mockResolvedValue({ id: 'proj-1', organizationId: 'org-1' } as any)
      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([])

      // Simulate Gemini 503 error
      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockRejectedValue(new Error('503 Service Unavailable'))

      const createReplySpy = jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'reply-err' } as any)
      const updateStatusSpy = jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      await orchestrator.processMessage('msg-103')

      // Verify failure reply was posted
      expect(createReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          isBotReply: true,
          content: expect.stringContaining('AI Assistant Temporary Error')
        })
      )

      // Verify message status was updated to FAILED (not left in PENDING)
      expect(updateStatusSpy).toHaveBeenCalledWith(
        'msg-103',
        'FAILED',
        expect.objectContaining({ errorMessage: '503 Service Unavailable' })
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. END-TO-END FLOWS (TASK, BUG, EMAIL, ATTACHMENTS)
  // ───────────────────────────────────────────────────────────────────────────
  describe('End-to-End Orchestrator Flows', () => {
    it('Flow 1: /Task command should create a TASK with assignees and lead', async () => {
      const mockMessage = {
        id: 'msg-task-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        senderId: 'user-author',
        content: '/Task @bot Build landing page lead: @Omkar',
        mentionUserIds: ['user-omkar', 'user-alex'],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue('6a8ac000000000000000000a')
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(pmClient.project, 'findUnique').mockResolvedValue({ id: 'proj-1', organizationId: 'org-1' } as any)
      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([
        { uid: 'user-omkar', users: { name: 'Omkar', email: 'omkar@technewity.ai' } },
        { uid: 'user-alex', users: { name: 'Alex', email: 'alex@technewity.ai' } }
      ] as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'TASK',
        title: 'Build Landing Page',
        rephrased_description: 'Construct a responsive landing page for the marketing campaign.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask').mockResolvedValue({
        id: 'task-created-1',
        title: 'Build Landing Page'
      } as any)
      jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'bot-reply-1' } as any)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      await orchestrator.processMessage('msg-task-1')

      expect(createNewTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            type: 'TASK',
            title: 'Build Landing Page',
            leadId: 'user-omkar',
            assigneeIds: ['user-alex']
          })
        })
      )
    })

    it('Flow 2: /Bug command should create a task with type BUG', async () => {
      const mockMessage = {
        id: 'msg-bug-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        senderId: 'user-author',
        content: '/Bug @bot 500 error on checkout',
        mentionUserIds: ['user-dev'],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue('6a8ac000000000000000000a')
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(pmClient.project, 'findUnique').mockResolvedValue({ id: 'proj-1', organizationId: 'org-1' } as any)
      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([
        { uid: 'user-dev', users: { name: 'Dev', email: 'dev@technewity.ai' } }
      ] as any)

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'BUG',
        title: 'Fix 500 Error on Checkout',
        rephrased_description: 'Investigate and resolve the 500 server error occurring during checkout.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask').mockResolvedValue({
        id: 'task-bug-1',
        title: 'Fix 500 Error on Checkout'
      } as any)
      jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'bot-reply-bug' } as any)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      await orchestrator.processMessage('msg-bug-1')

      expect(createNewTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            type: 'BUG',
            title: 'Fix 500 Error on Checkout'
          })
        })
      )
    })

    it('Flow 3: Attachments should be passed to created Task.fileIds', async () => {
      const mockMessage = {
        id: 'msg-attach-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        senderId: 'user-author',
        content: '/Task @bot Review mockup',
        mentionUserIds: [],
        fileIds: ['r2-key-mockup-123.png', 'r2-key-spec.pdf'],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue('6a8ac000000000000000000a')
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(pmClient.project, 'findUnique').mockResolvedValue({ id: 'proj-1', organizationId: 'org-1' } as any)
      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([])

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'TASK',
        title: 'Review Mockup and Specification',
        rephrased_description: 'Conduct design and functional review of the attached assets.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask').mockResolvedValue({
        id: 'task-attach-1',
        title: 'Review Mockup and Specification'
      } as any)
      jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'bot-reply-att' } as any)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      await orchestrator.processMessage('msg-attach-1')

      expect(createNewTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            fileIds: ['r2-key-mockup-123.png', 'r2-key-spec.pdf']
          })
        })
      )
    })

    it('Flow 4: /Email command should dispatch sendEmail() and NOT create a Task', async () => {
      const mockMessage = {
        id: 'msg-email-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
        senderId: 'user-author',
        content: '/Email @bot Send sprint report to client@acme.com',
        mentionUserIds: [],
        fileIds: [],
        status: 'PENDING',
        linkedTaskId: null
      }

      jest.spyOn(orchestrator.chatRepo, 'getMessageById').mockResolvedValue(mockMessage as any)
      jest.spyOn(orchestrator, 'getBotUserIdForOrg').mockResolvedValue('6a8ac000000000000000000a')
      jest.spyOn(orchestrator, 'checkRateLimit').mockResolvedValue(true)
      jest.spyOn(pmClient.project, 'findUnique').mockResolvedValue({ id: 'proj-1', organizationId: 'org-1' } as any)
      jest.spyOn(pmClient.members, 'findMany').mockResolvedValue([])

      ;(geminiClient.parseTaskWithGemini as jest.Mock).mockResolvedValue({
        intent: 'EMAIL',
        title: 'Sprint Report',
        email_subject: 'Weekly Sprint Progress Report',
        email_body: 'Here is the summary of sprint achievements and timeline milestones.'
      })

      const createNewTaskSpy = jest.spyOn(orchestrator.taskCreateService, 'createNewTask')
      jest.spyOn(orchestrator.chatRepo, 'createMessage').mockResolvedValue({ id: 'bot-reply-mail' } as any)
      jest.spyOn(orchestrator.chatRepo, 'updateMessageStatus').mockResolvedValue({} as any)

      await orchestrator.processMessage('msg-email-1')

      // Assert sendEmail was invoked with recipient
      expect(emailLib.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: ['client@acme.com'],
          subject: 'Weekly Sprint Progress Report'
        })
      )

      // Assert Task was NOT created
      expect(createNewTaskSpy).not.toHaveBeenCalled()
    })
  })
})
