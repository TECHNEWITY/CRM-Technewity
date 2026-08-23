import { BaseJob } from '../BaseJob'
import { BotOrchestratorService } from '../../services/ai/BotOrchestratorService'

export interface IProcessBotMessageData {
  chatMessageId: string
  projectId: string
  organizationId: string
  senderId: string
}

export class ProcessBotMessageJob extends BaseJob {
  name = 'process-bot-message'
  orchestrator: BotOrchestratorService

  constructor() {
    super()
    this.orchestrator = new BotOrchestratorService()
  }

  async implement(data: IProcessBotMessageData) {
    console.log('[ProcessBotMessageJob] Processing bot message:', data.chatMessageId)
    await this.orchestrator.processMessage(data.chatMessageId)
  }
}
