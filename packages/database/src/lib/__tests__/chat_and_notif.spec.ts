import { ChatRepository } from '../chat.repository'
import { NotificationRepository } from '../notification.repository'
import { AiUsageLogRepository } from '../aiUsageLog.repository'

describe('Database Repositories for Bot & Notifications', () => {
  it('should instantiate ChatRepository', () => {
    const repo = new ChatRepository()
    expect(repo).toBeDefined()
    expect(typeof repo.createMessage).toBe('function')
    expect(typeof repo.getMessagesByProject).toBe('function')
    expect(typeof repo.updateMessageStatus).toBe('function')
  })

  it('should instantiate NotificationRepository', () => {
    const repo = new NotificationRepository()
    expect(repo).toBeDefined()
    expect(typeof repo.createNotification).toBe('function')
    expect(typeof repo.getNotificationsByUser).toBe('function')
    expect(typeof repo.markAsRead).toBe('function')
  })

  it('should instantiate AiUsageLogRepository', () => {
    const repo = new AiUsageLogRepository()
    expect(repo).toBeDefined()
    expect(typeof repo.logUsage).toBe('function')
  })
})
