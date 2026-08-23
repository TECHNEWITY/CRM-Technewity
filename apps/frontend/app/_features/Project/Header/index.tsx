import { useState, useEffect } from 'react'
import ProjectMemberView from "@/features/ProjectMember/View"
import { useProjectStore } from "@/store/project"
import { projectUpdate } from "@/services/project"
import { HiOutlinePencilSquare, HiOutlineCheck, HiSparkles } from "react-icons/hi2"
import { messageError, messageSuccess } from "@ui-components"
import NotificationBell from "@/features/NotificationCenter"
import { useChatStore } from "@/store/chat"

export default function ProjectHeader() {
  const { selectedProject, updateProject } = useProjectStore(state => state)
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    if (selectedProject?.name) {
      setName(selectedProject.name)
    }
  }, [selectedProject?.name])

  const handleSave = async () => {
    if (!selectedProject || !name.trim()) return
    const trimmed = name.trim()
    setIsEditing(false)
    updateProject({ id: selectedProject.id, name: trimmed })
    try {
      await projectUpdate({ id: selectedProject.id, name: trimmed })
      messageSuccess('Project renamed successfully!')
    } catch (err) {
      messageError('Failed to rename project')
    }
  }

  return (
    <h2 className="text-xl pb-2 sm:pb-0 dark:text-gray-200 font-bold px-4 pt-2 flex items-center justify-between">
      <div className="flex items-center gap-2 mb-1 group">
        {selectedProject?.icon ? (
          <img
            alt={selectedProject.icon}
            src={selectedProject?.icon || ''}
            className="w-6 h-6"
          />
        ) : null}

        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              className="px-2 py-0.5 text-lg font-bold border rounded dark:bg-gray-800 dark:border-gray-700 outline-none focus:ring-2 focus:ring-indigo-500"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setIsEditing(false)
              }}
              autoFocus
            />
            <button
              onClick={handleSave}
              className="p-1 text-green-600 hover:text-green-700 rounded hover:bg-green-50 dark:hover:bg-green-950">
              <HiOutlineCheck className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{selectedProject?.name || 'Project'}</span>
            {selectedProject?.id ? (
              <button
                onClick={() => setIsEditing(true)}
                title="Rename Project"
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-indigo-600 rounded">
                <HiOutlinePencilSquare className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <button
          type="button"
          onClick={() => useChatStore.getState().toggleOpen()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 rounded-lg border border-indigo-200/80 dark:border-indigo-800 transition-colors shadow-sm"
          title="Open AI Chat & Task Bot"
        >
          <HiSparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span className="hidden sm:inline">AI Chat & Bot</span>
        </button>
        <ProjectMemberView />
      </div>
    </h2>
  )
}
