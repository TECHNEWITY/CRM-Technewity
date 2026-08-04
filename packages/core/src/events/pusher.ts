'use client'

import Pusher, { Channel } from 'pusher-js'

const key = process.env.NEXT_PUBLIC_PUSHER_CHANNEL_APP_KEY
const cluster = process.env.NEXT_PUBLIC_PUSHER_CHANNEL_APP_CLUSTER

export let pusherClient: Pusher | undefined
export let channelTeamCollab: Channel | undefined

if (key && cluster) {
  try {
    pusherClient = new Pusher(key, { cluster })
    channelTeamCollab = pusherClient.subscribe('team-collab')
  } catch (error) {
    console.warn('Pusher client failed to initialize:', error)
  }
}

