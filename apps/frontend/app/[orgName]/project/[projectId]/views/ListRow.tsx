import TaskCheckbox from '@/components/TaskCheckbox'
import { ExtendedTask } from '@/store/task'
import TaskStatus from './TaskStatus'
import TaskActions from '@/features/TaskActions'
import ListCell from './ListCell'
import TaskAssignee from './TaskAssignee'
import TaskPriorityCell from './TaskPriorityCell'
import TaskPoint from './TaskPoint'
import TaskDate from './TaskDate'
import ProgressBar from '@/components/ProgressBar'
import { useParams, useRouter } from 'next/navigation'
import { useUrl } from '@/hooks/useUrl'
import { Loading, Tooltip, messageWarning } from '@ui-components'

import TaskTypeCell from './TaskTypeCell'
import TaskChecklist from '@/features/TaskChecklist'
import TaskProgress from './TaskProgress'
import { useMemo } from 'react'
import TaskTitle from './TaskTitle'
import MemberAvatar from '@/components/MemberAvatar'
import { HiOutlineSparkles } from 'react-icons/hi2'

export default function ListRow({ task }: { task: ExtendedTask }) {
  const isRandomId = task.id.includes('TASK-ID-RAND')
  const progress = useMemo(() => {
    const done = task.checklistDone || 0
    const todo = task.checklistTodos || 0
    const percent = (done / (todo + done)) * 100
    return isNaN(percent) ? 0 : Math.round(percent)
  }, [JSON.stringify(task)])

  return (
    <div
      className="px-3 py-2.5 text-sm flex flex-col sm:flex-row sm:items-center justify-between group relative transition-all hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-md border sm:border-0 border-gray-100 dark:border-gray-800/80 my-1 sm:my-0 shadow-sm sm:shadow-none"
      key={task.id}>
      <div className="flex items-center gap-2.5 dark:text-gray-300 w-full sm:w-auto">
        <TaskCheckbox id={task.id} selected={task.selected} />
        <TaskStatus taskId={task.id} value={task.taskStatusId || ''} />

        {isRandomId ? <Loading enabled={true} spinnerSpeed="fast" /> : null}
        <div className="flex-1 min-w-0">
          <TaskTitle id={task.id} projectId={task.projectId} title={task.title} />
        </div>
        <TaskActions
          className="opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all duration-100 ml-auto"
          taskId={task.id}
        />
      </div>
      <div className="mt-2.5 sm:mt-0 flex items-center justify-between sm:justify-end gap-3 text-xs font-medium text-gray-500 dark:text-gray-400 border-t pt-2 sm:border-t-0 sm:pt-0 dark:border-gray-800">
        <ListCell className="sm:w-[150px]">
          <TaskAssignee
            className="no-name"
            taskId={task.id}
            uids={task.assigneeIds}
          />
        </ListCell>
        <ListCell className="hidden sm:block" width={115}>
          <TaskTypeCell type={task.type} taskId={task.id} />
        </ListCell>
        <ListCell width={75} className="hidden sm:block">
          <TaskPriorityCell taskId={task.id} value={task.priority} />
        </ListCell>
        <ListCell className="hidden sm:w-[50px] sm:block">
          <TaskPoint taskId={task.id} value={task.taskPoint} />
        </ListCell>
        <ListCell className="sm:w-[110px]">
          <TaskDate
            toNow={true}
            taskId={task.id}
            date={task.dueDate ? new Date(task.dueDate) : null}
          />
        </ListCell>
        <ListCell className="hidden sm:block" width={70}>
          <TaskProgress progress={progress} taskId={task.id} />
        </ListCell>
        {/* Creator badge — visible to all team members */}
        <ListCell className="hidden sm:flex items-center" width={60}>
          {(task as any).createdVia === 'BOT' ? (
            <Tooltip title="Created via AI Bot">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                <HiOutlineSparkles className="w-3 h-3" />
                Bot
              </span>
            </Tooltip>
          ) : (task as any).createdBy ? (
            <Tooltip title="Created manually">
              <div className="shrink-0">
                <MemberAvatar uid={(task as any).createdBy} size="sm" noName={true} />
              </div>
            </Tooltip>
          ) : null}
        </ListCell>
      </div>
    </div>
  )
}

