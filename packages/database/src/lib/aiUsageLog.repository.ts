import { aiUsageLogModel } from './_prisma'

export class AiUsageLogRepository {
  async logUsage(data: {
    organizationId: string
    userId: string
    chatMessageId?: string
    action: string
    tokensUsed?: number
    success: boolean
  }) {
    try {
      return await aiUsageLogModel.create({
        data: {
          organizationId: data.organizationId,
          userId: data.userId,
          chatMessageId: data.chatMessageId || null,
          action: data.action,
          tokensUsed: data.tokensUsed || null,
          success: data.success,
          createdAt: new Date()
        }
      })
    } catch (error) {
      console.error('[AiUsageLog Error] Failed to log AI usage:', error)
      return null
    }
  }

  async getRecentLogs(organizationId: string, limit = 50) {
    return await aiUsageLogModel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit
    })
  }
}
