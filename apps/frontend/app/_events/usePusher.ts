import Pusher, { Channel } from 'pusher-js'
import { useEffect, useState } from 'react'

export const usePusher = () => {
  const [channelTeamCollab, setChannelTeamCollab] = useState<Channel>()
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_CHANNEL_APP_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CHANNEL_APP_CLUSTER
    if (!key || !cluster) {
      return
    }

    try {
      const pusherClient = new Pusher(key, { cluster })
      const channel = pusherClient.subscribe('team-collab')
      setChannelTeamCollab(channel)
    } catch (e) {
      console.warn('Pusher initialization error:', e)
    }
  }, [])

  return {
    channelTeamCollab
  }
}
