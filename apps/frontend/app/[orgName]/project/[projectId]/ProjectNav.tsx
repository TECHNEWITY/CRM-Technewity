'use client'
import ProjectTabContent from './ProjectTabContent'
import TaskCreate from './TaskCreate'
import ProjectView from '@/features/ProjectView'
import { TaskUpdate2 } from './TaskUpdate2'
import ProjectAdvanceTabs from '@/features/ProjectAdvanceTabs'
import ProjectHeader from '@/features/Project/Header'
import CustomFieldModal from '@/features/CustomField/CustomFieldModal'
import ChatDrawer from '@/features/ProjectChat'
import { useChatStore } from '@/store/chat'
import { HiSparkles } from 'react-icons/hi2'

export default function ProjectNav() {

  return (
    <div className="project-nav">
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <ProjectHeader />
        <div className="project-tab-bar-mobile flex items-center justify-between w-full px-2 py-1 border-t sm:border-t-0 dark:border-gray-800">
          <div className="flex items-center shrink-0">
            <ProjectView />
            <ProjectAdvanceTabs />
          </div>
        </div>
      </div>

      <div className="task bg-indigo-50/50 dark:bg-[#182031] w-full">
        <ProjectTabContent />
      </div>
      <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => useChatStore.getState().toggleOpen()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-medium text-xs shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all hover:scale-105 active:scale-95"
          title="Open AI Project Chat & Task Bot"
        >
          <HiSparkles className="w-4 h-4 text-yellow-300 animate-pulse" />
          <span>AI Chat & Bot</span>
        </button>
        <div className="hidden sm:flex items-center gap-2">
          {/* <PromptGenerator /> */}
          {/* <FavoriteAddModal /> */}
          <TaskCreate />
        </div>
      </div>
      <TaskUpdate2 />
      <CustomFieldModal />
      <ChatDrawer />
    </div>
  )
}
