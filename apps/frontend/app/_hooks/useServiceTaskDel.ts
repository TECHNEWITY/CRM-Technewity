import { taskDelete, taskDeletes } from '@/services/task'
import { useTaskStore } from '@/store/task'
import { useParams } from 'next/navigation'
import localforage from 'localforage'

export const useServiceTaskDel = () => {
  const { projectId } = useParams()
  const { delTask, delTasks } = useTaskStore()

  const updateLocalForageCache = (targetProjectId: string, deletedIds: string[]) => {
    if (!targetProjectId) return
    const cacheKey = `TASKLIST_${targetProjectId}`
    localforage.getItem<any[]>(cacheKey).then(cached => {
      if (cached && Array.isArray(cached)) {
        const updated = cached.filter(t => !deletedIds.includes(t.id))
        localforage.setItem(cacheKey, updated)
      }
    }).catch(() => {})
  }

  const deleteTask = (id: string, customProjectId?: string) => {
    const targetProjId = (customProjectId || projectId || '') as string
    console.log('delete task called', id, targetProjId)
    delTask(id)
    updateLocalForageCache(targetProjId, [id])

    taskDelete({
      projectId: targetProjId,
      id
    })
  }

  const deleteMultiTask = (ids: string[], customProjectId?: string) => {
    const targetProjId = (customProjectId || projectId || '') as string
    delTasks(ids)
    updateLocalForageCache(targetProjId, ids)

    taskDeletes({
      projectId: targetProjId,
      ids
    })
  }

  const deleteLocalTask = (id: string, customProjectId?: string) => {
    const targetProjId = (customProjectId || projectId || '') as string
    delTask(id)
    updateLocalForageCache(targetProjId, [id])
  }

  return {
    deleteMultiTask,
    deleteLocalTask,
    deleteTask
  }
}
