import { httpGet, httpPatch } from './_req'

export const notificationGetAll = (params?: { limit?: number }) => {
  return httpGet('/api/notifications', { params })
}

export const notificationMarkRead = (id: string) => {
  return httpPatch(`/api/notifications/${id}/read`, {})
}

export const notificationMarkAllRead = () => {
  return httpPatch('/api/notifications/read-all', {})
}
