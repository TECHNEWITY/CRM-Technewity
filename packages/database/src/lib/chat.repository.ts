import { ChatMessage, ChatMessageStatus } from '@prisma/client'
import { chatMessageModel } from './_prisma'

export class ChatRepository {
  async createMessage(data: Omit<ChatMessage, 'id' | 'createdAt' | 'updatedAt'>) {
    return await chatMessageModel.create({
      data: {
        organizationId: data.organizationId,
        projectId: data.projectId,
        senderId: data.senderId,
        content: data.content,
        mentionUserIds: data.mentionUserIds || [],
        fileIds: data.fileIds || [],
        commandType: data.commandType || null,
        status: data.status || ChatMessageStatus.SENT,
        linkedTaskId: data.linkedTaskId || null,
        errorMessage: data.errorMessage || null,
        isBotReply: data.isBotReply || false,
        createdAt: new Date()
      }
    })
  }

  async getMessagesByProject(projectId: string, limit = 50, before?: string) {
    const where: any = { projectId }
    if (before) {
      where.createdAt = { lt: new Date(before) }
    }

    const messages = await chatMessageModel.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit
    })

    return messages
  }

  async getMessageById(id: string) {
    return await chatMessageModel.findUnique({
      where: { id }
    })
  }

  async updateMessageStatus(
    id: string,
    status: ChatMessageStatus,
    extra?: { linkedTaskId?: string; errorMessage?: string; commandType?: any }
  ) {
    return await chatMessageModel.update({
      where: { id },
      data: {
        status,
        ...(extra?.linkedTaskId && { linkedTaskId: extra.linkedTaskId }),
        ...(extra?.errorMessage && { errorMessage: extra.errorMessage }),
        ...(extra?.commandType && { commandType: extra.commandType }),
        updatedAt: new Date()
      }
    })
  }
}
