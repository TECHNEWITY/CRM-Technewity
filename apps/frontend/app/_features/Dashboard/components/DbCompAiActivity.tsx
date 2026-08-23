import { useTaskStore } from '@/store/task'
import { Task } from '@prisma/client'
import { HiSparkles, HiArrowTopRightOnSquare } from 'react-icons/hi2'
import { useUrl } from '@/hooks/useUrl'
import { useOrgSlug } from '@/hooks/useOrgSlug'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

export default function DbCompAiActivity() {
  const { tasks } = useTaskStore()
  const { projectId } = useUrl()
  const { orgSlug } = useOrgSlug()
  const router = useRouter()

  const botTasks = (tasks || [])
    .filter((t) => (t as any).createdVia === 'BOT' || (t as any).createdVia === 'BOT')
    .slice(0, 5)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <HiSparkles className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            Recent AI Activity
          </h3>
        </div>
        <span className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full font-medium">
          {botTasks.length} Created via Bot
        </span>
      </div>

      {botTasks.length === 0 ? (
        <div className="p-6 text-center text-gray-400 text-xs bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-dashed border-gray-200 dark:border-gray-800">
          <p>No tasks created via AI Bot yet.</p>
          <p className="mt-1 text-[11px]">Use <code>@bot /Task</code> in the Project Chat drawer to get started!</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {botTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => router.push(`/${orgSlug}/project/${projectId}?mode=task&taskId=${task.id}`)}
              className="py-2.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/40 px-2 rounded-lg cursor-pointer transition-colors"
            >
              <div className="min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${task.type === 'BUG' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'}`}>
                    {task.type || 'TASK'}
                  </span>
                  <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {task.title}
                  </p>
                </div>
                {task.createdAt && (
                  <span className="text-[10px] text-gray-400 mt-0.5 block">
                    {format(new Date(task.createdAt), 'MMM d, h:mm a')}
                  </span>
                )}
              </div>

              <HiArrowTopRightOnSquare className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
