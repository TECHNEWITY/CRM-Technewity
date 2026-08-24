import { useEffect, useRef } from 'react'
import { usePusher } from './usePusher'
import { ChatMessage } from '@prisma/client'

export const useEventProjectChat = (projectId: string, cb: (data: ChatMessage) => void) => {
  const { channelTeamCollab } = usePusher()
  const cbRef = useRef(cb)

  useEffect(() => {
    cbRef.current = cb
  }, [cb])

  useEffect(() => {
    if (!channelTeamCollab || !projectId) return

    const eventName = `chat-message-${projectId}`
    console.log(`[Pusher] Subscribing to ${eventName}`)

    const handleMessage = (data: ChatMessage) => {
      console.log(`[Pusher] Received chat message:`, data)
      cbRef.current && cbRef.current(data)
    }

    channelTeamCollab.bind(eventName, handleMessage)

    return () => {
      channelTeamCollab.unbind(eventName, handleMessage)
    }
  }, [channelTeamCollab, projectId])
}
