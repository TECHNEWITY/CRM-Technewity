'use client'
import HamburgerMenu from '@/components/HamburgerMenu'
import ProjectSidebar from './ProjectSidebar'
import { useOrgMemberGet } from '@/services/organizationMember'
import EventUserProjectUpdate from '@/features/Events/EventUserProjectUpdate'
import { useOrgIdBySlug } from '@/hooks/useOrgIdBySlug'
import { Loading } from '@ui-components'
import { ReactNode, useEffect } from 'react'
import { useGlobalDataFetch } from '@/features/GlobalData/useGlobalDataFetch'
import { useGlobalDataStore } from '@/store/global'
import { setLocalCache } from '@namviek/core/client'
import Upsale from '@/features/UpsaleDialog'
import GlobalTimerDisplay from '@/features/TimeTracker/GlobalTimerDisplay'

import MobileBottomNav from '../_components/MobileBottomNav'

// NOTE: do not move these following function inside ProjectLayout
// cuz it causes a re-render to the entire component
// why ? because it contains useParams inside, and this will triggered as url updated
function PrefetchOrgData() {
  useOrgMemberGet()
  return <></>
}

function OrgDetailContent({ children }: { children: ReactNode }) {
  const { orgId } = useGlobalDataStore()

  if (!orgId) {
    return <Loading className='h-screen w-screen items-center justify-center' title='Fetching organization data ...' />
  }

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-gray-50 dark:bg-gray-950 relative">
      <PrefetchOrgData />
      <EventUserProjectUpdate />
      <ProjectSidebar />
      <Upsale />
      <main className="main-content w-full flex-1 overflow-x-hidden min-h-screen flex flex-col min-w-0 pb-[65px] md:pb-0">
        <HamburgerMenu />
        {children}
      </main>
      <MobileBottomNav />
      <GlobalTimerDisplay />
    </div>
  )
}

// This will clear the global data as the org page unmount
function OrgDetailClearGlobalData() {
  const { setOrgId } = useGlobalDataStore()

  useEffect(() => {
    return () => {
      console.log('Clear data inside Global data store !')
      setOrgId('')

      setLocalCache('ORG_ID', '')
      setLocalCache('ORG_SLUG', '')
    }
  }, [])
  return <></>
}

// This component used for fetching global data
function OrgDetailFetchGlobalData() {
  useGlobalDataFetch()
  return <></>
}

export default function ProjectLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <OrgDetailFetchGlobalData />
      <OrgDetailClearGlobalData />
      <OrgDetailContent>{children}</OrgDetailContent>
    </>
  )
}
