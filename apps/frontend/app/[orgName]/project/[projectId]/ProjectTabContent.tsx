'use client'

import ProjectOverview from '@/features/Project/Overview'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import ProjectContentLoading from './ProjectContentLoading'
import TaskList from './TaskList'
import { useProjectViewStore } from '@/store/projectView'
import { ProjectViewType } from '@prisma/client'
import { Loading } from '@ui-components'
import { useProjectStatusStore } from '@/store/status'
import { projectViewMap } from '@/features/ProjectView/useProjectViewList'
import React, { useCallback, useMemo } from 'react'
import { useReRenderView } from '@/features/ProjectView/useReRenderView'

const DynamicTeamView = dynamic(() => import('@/features/Project/Team'), {
  loading: () => <ProjectContentLoading />
})
const Calendar = dynamic(() => import('./calendar'), {
  loading: () => <ProjectContentLoading />
})
const Board = dynamic(() => import('./board'), {
  loading: () => <ProjectContentLoading />
})

const Vision = dynamic(() => import('@/features/Project/Vision'), {
  loading: () => <ProjectContentLoading />
})

const Grid = dynamic(() => import('@/features/Project/GridView'), {
  loading: () => <ProjectContentLoading />
})

const Settings = dynamic(() => import('./settings'), {
  loading: () => <ProjectContentLoading />
})

const MindMap = dynamic(() => import('@/features/Project/MindMap'), {
  loading: () => <ProjectContentLoading />
})

const Automation = dynamic(() => import('@/features/Automation'), {
  loading: () => <ProjectContentLoading />
})

const AutomateMenu = dynamic(
  () => import('@/features/Automation/AutomateMenu'),
  {
    loading: () => <ProjectContentLoading />
  }
)

function AnimateView({
  visible,
  children
}: {
  visible: boolean
  children: React.ReactNode
}) {
  if (!visible) return null
  return <>{children}</>
  // const id = useId()
  // return (
  //   <AnimatePresence>
  //     {visible ? (
  //       <motion.div
  //         key={id}
  //         initial={{ opacity: 0 }}
  //         animate={{ opacity: 1 }}
  //         exit={{ opacity: 0 }}>
  //         {children}
  //       </motion.div>
  //     ) : null}
  //   </AnimatePresence>
  // )
}

function ProjectTabContentLoading() {
  const { loading } = useProjectViewStore()
  const { statusLoading } = useProjectStatusStore()

  if (loading || statusLoading) {
    return (
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-center py-1.5 px-3 bg-indigo-50/90 dark:bg-indigo-950/90 border-b border-indigo-100 dark:border-indigo-900 text-indigo-600 dark:text-indigo-300 text-xs font-medium shadow-sm transition-all animate-pulse">
        <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent dark:border-indigo-400 dark:border-t-transparent rounded-full animate-spin mr-2" />
        <span>Preparing view...</span>
      </div>
    )
  }

  return null
}

export default function ProjectTabContent() {
  const searchParams = useSearchParams()
  const { counter } = useReRenderView()
  const mode = searchParams.get('mode')

  const isIgnored = useCallback(() => {
    const ignored = ['setting', 'mindmap', 'automation', 'automation-create']
    return ignored.includes(mode || '')
  }, [mode])

  const type = projectViewMap.get(mode || '') || 'NONE'

  const isView = useCallback((t: ProjectViewType) => !isIgnored() && type === t, [isIgnored, type])
  const isNotBoard = !isView(ProjectViewType.BOARD)

  // Note: only enable overflow-y to Board view
  // to keep the scrollbar inside tabcontent
  // not the whole page
  const cls = `relative ${isNotBoard ? 'overflow-y-auto' : null}`

  const view = useMemo(() => {
    return <div className={cls} style={{ height: 'calc(100vh - 83px)' }}>
      <ProjectTabContentLoading />
      <AnimateView visible={type === 'NONE' && !isIgnored()}>
        <TaskList />
      </AnimateView>
      <AnimateView visible={isView(ProjectViewType.BOARD)}>
        <Board />
      </AnimateView>
      <AnimateView visible={isView(ProjectViewType.GRID)}>
        <Grid />
      </AnimateView>
      <AnimateView visible={isView(ProjectViewType.LIST)}>
        <TaskList />
      </AnimateView>
      <AnimateView visible={isView(ProjectViewType.CALENDAR)}>
        <Calendar />
      </AnimateView>
      <AnimateView visible={isView(ProjectViewType.GOAL)}>
        <Vision />
      </AnimateView>
      <AnimateView visible={isView(ProjectViewType.DASHBOARD)}>
        <ProjectOverview />
      </AnimateView>
      <AnimateView visible={isView(ProjectViewType.TEAM)}>
        <DynamicTeamView />
      </AnimateView>
      {mode === 'mindmap' && <MindMap />}
      {mode === 'setting' && <Settings />}
      {mode === 'automation-create' ? <Automation /> : null}
      {mode === 'automation' ? <AutomateMenu /> : null}
    </div>
  }, [cls, type, isIgnored, mode, isView, counter])

  return view
}
