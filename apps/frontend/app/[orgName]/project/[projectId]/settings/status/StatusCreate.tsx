import { useUserRole } from '@/features/UserPermission/useUserRole'
import { useStatus } from '@/hooks/status'
import { useRef, KeyboardEvent, useMemo, useState } from 'react'
import { AiOutlinePlus } from 'react-icons/ai'
import { StatusType } from '@prisma/client'

const STATUS_TYPE_OPTIONS: { value: StatusType; label: string; color: string }[] = [
  { value: StatusType.TODO, label: 'To Do', color: '#9ca3af' },
  { value: StatusType.INPROCESS, label: 'In Progress', color: '#3b82f6' },
  { value: StatusType.DONE, label: 'Done', color: '#22c55e' }
]

export default function StatusCreate() {
  const inputAddRef = useRef<HTMLInputElement>(null)
  const [selectedType, setSelectedType] = useState<StatusType>(StatusType.TODO)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const { createNewStatus } = useStatus({ statusType: selectedType })
  const { projectRole } = useUserRole()

  const onPressEnter = (e: KeyboardEvent<HTMLDivElement>) => {
    createNewStatus(e, inputAddRef)
  }

  const placeholder = useMemo(() => {
    return !projectRole
      ? ''
      : projectRole === 'MANAGER' || projectRole === 'LEADER'
      ? 'Hit `Enter` to add a new status'
      : 'Only your boss can add new status'
  }, [projectRole])

  const readOnly = projectRole === 'MEMBER' || projectRole === 'GUEST'

  const selectedOption = STATUS_TYPE_OPTIONS.find(o => o.value === selectedType) || STATUS_TYPE_OPTIONS[0]

  return (
    <div className="relative flex items-center bg-gray-50 dark:bg-gray-800 rounded-b-lg gap-2 px-4 py-2">
      <AiOutlinePlus className="text-gray-500 shrink-0" />
      <input
        readOnly={readOnly}
        ref={inputAddRef}
        className="bg-transparent flex-1 text-gray-500 text-sm outline-none py-1"
        placeholder={placeholder}
        onKeyDown={onPressEnter}
      />
      {!readOnly && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowTypeMenu(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 transition-colors"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: selectedOption.color }}
            />
            {selectedOption.label}
            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showTypeMenu && (
            <div className="absolute bottom-full right-0 mb-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden min-w-[130px]">
              {STATUS_TYPE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setSelectedType(option.value)
                    setShowTypeMenu(false)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    selectedType === option.value ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: option.color }} />
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
