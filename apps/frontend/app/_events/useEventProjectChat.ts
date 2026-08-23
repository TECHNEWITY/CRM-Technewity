import { useEffect } from 'react'
import { usePusher } from './usePusher'
import { ChatMessage } from '@prisma/client'

export const useEventProjectChat = (projectId: string, cb: (data: ChatMessage) => void) => {
  const { channelTeamCollab } = usePusher()

  useEffect(() => {
    if (!channelTeamCollab || !projectId) return

    const eventName = `chat-message-${projectId}`
    console.log(`[Pusher] Subscribing to ${eventName}`)

    channelTeamCollab.bind(eventName, (data: ChatMessage) => {
      console.log(`[Pusher] Received chat message:`, data)
      cb && cb(data)
    })

    return () => {
      channelTeamCollab.unbind(eventName)
    }
  }, [channelTeamCollab, projectId, cb])
}
