import { httpPost } from './_req'

export const aiRephrase = (text: string, organizationId?: string) => {
  return httpPost('/api/ai/rephrase', {
    text,
    organizationId
  })
}
