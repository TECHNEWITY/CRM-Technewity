import { BaseQueue } from '../BaseQueue'
import { ProcessBotMessageJob, IProcessBotMessageData } from './ProcessBotMessageJob'

export class BotQueue extends BaseQueue {
  constructor() {
    super()
    this.queueName = 'BotMessageQueue'
    this.jobs = [new ProcessBotMessageJob()]

    this.run()
  }

  async enqueueBotMessage(data: IProcessBotMessageData) {
    return this.queue.add('process-bot-message', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true
    })
  }
}

let instance: BotQueue | null = null

export const getBotQueueInstance = () => {
  if (!instance) {
    instance = new BotQueue()
  }
  return instance
}
