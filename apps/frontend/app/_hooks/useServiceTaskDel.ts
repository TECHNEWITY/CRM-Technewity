import { taskDelete, taskDeletes } from '@/services/task'
import { useTaskStore } from '@/store/task'
import { useParams } from 'next/navigation'
import localforage from 'localforage'

export const useServiceTaskDel = () => {
  const { projectId } = useParams()
  const { delTask, delTasks } = useTaskStore()

  const updateLocalForageCache = async (targetProjectId: string, deletedIds: string[]) => {
    if (!targetProjectId) return
    const cacheKey = `TASKLIST_${targetProjectId}`
    try {
      const cached = await localforage.getItem<any[]>(cacheKey)
      if (cached && Array.isArray(cached)) {
        const updated = cached.filter(t => !deletedIds.includes(t.id))
        await localforage.setItem(cacheKey, updated)
      } else {
        await localforage.removeItem(cacheKey)
      }
    } catch {
      await localforage.removeItem(cacheKey).catch(() => {})
    }
  }

  const deleteTask = async (id: string, customProjectId?: string) => {
    const targetProjId = (customProjectId || projectId || '') as string
    console.log('delete task called', id, targetProjId)
    delTask(id)
    await updateLocalForageCache(targetProjId, [id])
    if (targetProjId) {
      await localforage.removeItem(`TASKLIST_${targetProjId}`).catch(() => {})
    }

    return taskDelete({
      projectId: targetProjId,
      id
    })
  }

  const deleteMultiTask = async (ids: string[], customProjectId?: string) => {
    const targetProjId = (customProjectId || projectId || '') as string
    delTasks(ids)
    await updateLocalForageCache(targetProjId, ids)
    if (targetProjId) {
      await localforage.removeItem(`TASKLIST_${targetProjId}`).catch(() => {})
    }

    return taskDeletes({
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
