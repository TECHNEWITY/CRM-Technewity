import { httpGet, httpPost } from './_req'

export interface IChatMessagePayload {
  content: string
  fileIds?: string[]
  mentionUserIds?: string[]
  organizationId?: string
}

export const chatSendMessage = (projectId: string, payload: IChatMessagePayload) => {
  return httpPost(`/api/project/${projectId}/chat/message`, payload)
}

export const chatGetMessages = (projectId: string, params?: { limit?: number; before?: string }) => {
  return httpGet(`/api/project/${projectId}/chat/messages`, { params })
}
