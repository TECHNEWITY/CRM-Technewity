import { DraggableProvided } from 'react-beautiful-dnd'
import { MdDragIndicator } from 'react-icons/md'
import { Avatar, confirmAlert, messageError, messageSuccess } from '@ui-components'
import Badge from '@/components/Badge'
import useTaskFilterContext from '@/features/TaskFilter/useTaskFilterContext'
import { HiOutlineTrash } from 'react-icons/hi2'
import { projectStatusDel } from '@/services/status'
import { useProjectStatusStore } from '@/store/status'
import { useTaskStore } from '@/store/task'
import { taskUpdate } from '@/services/task'
import localforage from 'localforage'
import { useParams } from 'next/navigation'

interface IBoardHeaderProps {
  color?: string
  icon?: string
  name: string
  id: string
  total: number
  provided: DraggableProvided
}
export default function BoardHeader({
  color,
  icon,
  name,
  total,
  id,
  provided
}: IBoardHeaderProps) {
  const { isGroupbyAssignee, isGroupbyStatus, groupByLoading } =
    useTaskFilterContext()
  const { statuses, delStatus } = useProjectStatusStore()
  const { tasks, updateTask } = useTaskStore()
  const { projectId } = useParams()

  const handleDeleteStatus = () => {
    confirmAlert({
      message: `Are you sure you want to delete status "${name}"? Tasks in this status will be moved to default status.`,
      yes: async () => {
        try {
          delStatus(id)
          await projectStatusDel(id)
          if (projectId) {
            localforage.removeItem(`PROJECT_STATUS_${projectId}`)
          }
          messageSuccess('Status deleted successfully')
        } catch (err) {
          messageError('Failed to delete status')
        }
      }
    })
  }

  const handleClearNoneColumn = () => {
    const defaultStatus = statuses[0]
    if (!defaultStatus) return

    confirmAlert({
      message: `Move all ${total} tasks in "None" to "${defaultStatus.name}" status?`,
      yes: () => {
        const noneTasks = tasks.filter(t => !t.taskStatusId || t.taskStatusId === 'NONE')
        noneTasks.forEach(t => {
          updateTask({ id: t.id, taskStatusId: defaultStatus.id })
          taskUpdate({ id: t.id, taskStatusId: defaultStatus.id })
        })
        if (projectId) {
          localforage.removeItem(`TASKLIST_${projectId}`)
        }
        messageSuccess(`Moved tasks to ${defaultStatus.name}`)
      }
    })
  }

  return (
    <div className="board-header group">
      <div
        className={`board-header-loading ${
          groupByLoading ? 'visible' : 'invisible '
        }`}></div>
      <div className="board-col-header flex items-center justify-between">
        <div
          className={`board-header-section ${
            groupByLoading ? 'opacity-0' : 'opacity-100'
          }`}>
          {isGroupbyStatus ? (
            <div
              className="w-3 h-4 text-gray-400 cursor-grab"
              {...provided.dragHandleProps}>
              <MdDragIndicator />
            </div>
          ) : null}
          {isGroupbyAssignee ? (
            <Avatar size="md" name={name} src={icon || ''} />
          ) : (
            <div
              className="w-4 h-4 rounded shrink-0"
              style={{ backgroundColor: color }}></div>
          )}
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{name}</span>
          <Badge title={total + ''} />
        </div>
        {isGroupbyStatus ? (
          <div>
            {id === 'NONE' ? (
              <button
                onClick={handleClearNoneColumn}
                title="Clear None Column (Move tasks to default status)"
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-xs text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded">
                Fix Status
              </button>
            ) : (
              <button
                onClick={handleDeleteStatus}
                title={`Delete Status ${name}`}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded">
                <HiOutlineTrash className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
