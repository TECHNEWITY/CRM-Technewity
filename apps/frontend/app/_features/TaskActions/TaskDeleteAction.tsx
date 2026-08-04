import { useTaskStore } from '@/store/task'
import { Button, confirmAlert, messageError, messageSuccess } from '@ui-components'
import localforage from 'localforage'
import { useParams } from 'next/navigation'
import { HiOutlineTrash } from 'react-icons/hi2'
import { taskDelete } from '@/services/task'
import { deleteState } from 'apps/frontend/libs/pushState'

export default function TaskDeleteAction({ id }: { id: string }) {
  const { projectId } = useParams()
  const { delTask, tasks } = useTaskStore()

  const onDelete = () => {
    confirmAlert({
      title: 'Delete task',
      message:
        'This action cannot be undone. Are you sure you want to delete this task permanently?',
      yes: async () => {
        // 1. Optimistic: remove from memory immediately
        const taskSnapshot = tasks.find(t => t.id === id)
        delTask(id)

        // 2. Wipe localforage so stale cache can't re-hydrate it on refresh
        const key = `TASKLIST_${projectId as string}`
        await localforage.removeItem(key)

        try {
          // 3. Call server — this is the source of truth
          const res = await taskDelete({ projectId: projectId as string, id })
          if (res?.data?.status !== 200) {
            throw new Error('Server returned non-200')
          }
          messageSuccess('Task deleted')
          // Close the task detail modal if open
          deleteState('taskId')
        } catch (err) {
          // 4. Rollback: server failed → add task back to memory
          console.error('Task delete failed, rolling back', err)
          if (taskSnapshot) {
            useTaskStore.getState().addAllTasks(
              [...useTaskStore.getState().tasks, taskSnapshot]
            )
          }
          messageError('Failed to delete task. Please try again.')
        }
      }
    })
  }
  return <Button onClick={onDelete} leadingIcon={<HiOutlineTrash />} />
}
