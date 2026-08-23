import { useGlobalDataStore } from '@/store/global'

/**
 * Returns the current org slug (e.g. "my-company") from global state.
 * Used in chat, notifications, and deep-linking.
 */
export const useOrgSlug = () => {
  const { orgName } = useGlobalDataStore()
  return { orgSlug: orgName }
}
