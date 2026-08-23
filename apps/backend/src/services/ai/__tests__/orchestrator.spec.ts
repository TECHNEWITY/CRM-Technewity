import { BotOrchestratorService } from '../BotOrchestratorService'

describe('BotOrchestratorService Deterministic Parsing', () => {
  let orchestrator: BotOrchestratorService

  beforeEach(() => {
    orchestrator = new BotOrchestratorService()
  })

  it('should extract slash commands properly', () => {
    const fn = (orchestrator as any).extractSlashCommand.bind(orchestrator)
    expect(fn('/Task @bot build blog')).toBe('TASK')
    expect(fn('/Bug @bot login button is broken')).toBe('BUG')
    expect(fn('/Email @bot mail the report to @user')).toBe('EMAIL')
    expect(fn('@bot just some text')).toBeNull()
  })

  it('should convert html to plain text cleanly', () => {
    const fn = (orchestrator as any).htmlToPlainText.bind(orchestrator)
    const html = '<p>Hello <strong>World</strong><br/>Line 2</p>'
    expect(fn(html)).toBe('Hello World Line 2')
  })

  it('should extract literal email from text', () => {
    const fn = (orchestrator as any).extractLiteralEmail.bind(orchestrator)
    expect(fn('Send this to test@example.com please')).toBe('test@example.com')
    expect(fn('No email here')).toBeNull()
  })

  it('should extract leadId when lead keyword is present with mention span', () => {
    const fn = (orchestrator as any).extractLeadId.bind(orchestrator)
    const result = fn({
      htmlContent: '<p>/Task @bot write blog lead: <span data-id="user-123" class="mention">@Omkar</span></p>',
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
