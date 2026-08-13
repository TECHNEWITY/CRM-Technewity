'use client'

import { useState } from 'react'
import { ETaskFilterGroupByType } from '@/features/TaskFilter/context'
import './style.css'
import { DragDropContext, DropResult, Droppable } from 'react-beautiful-dnd'
import * as Tabs from '@radix-ui/react-tabs'

import { useBoardDndAction } from './useBoardDndAction'
import BoardColumnDraggable from './BoardColumnDraggable'
import { triggerEventTaskReorder } from '@/events/useEventTaskReorder'
import { useUrl } from '@/hooks/useUrl'
import { useBoardRealtimeUpdate } from './useBoardRealtimeUpdate'
import { triggerEventMoveTaskToOtherBoard } from '@/events/useEventMoveTaskToOtherBoard'
import useTaskFilterContext from '@/features/TaskFilter/useTaskFilterContext'

export default function BoardContainer() {
  const { projectId } = useUrl()
  const { groupByItems, filter, groupBy } = useTaskFilterContext()
  const {
    dragColumnToAnotherPosition,
    dragItemToAnotherPosition,
    dragItemToAnotherColumn
  } = useBoardDndAction()

  const { statusIds } = filter
  const [activeMobileTab, setActiveMobileTab] = useState<string>(
    groupByItems[0]?.id || ''
  )

  useBoardRealtimeUpdate()

  const onDragEnd = (result: DropResult) => {
    const { source, destination, type } = result

    if (!source || !destination) return
    if (source.droppableId === 'all-column') return

    const sourceIndex = source.index
    const destIndex = destination.index
    const sourceColId = source.droppableId
    const destColId = destination.droppableId

    if (type === 'column') {
      dragColumnToAnotherPosition({
        sourceIndex,
        destIndex
      })
      return
    }

    // reorder task
    if (sourceColId === destColId) {
      triggerEventTaskReorder({
        projectId,
        sourceIndex,
        destIndex,
        sourceColId
      })

      dragItemToAnotherPosition({
        sourceIndex,
        destIndex,
        sourceColId
      })
    }

    if (sourceColId !== destColId) {
      triggerEventMoveTaskToOtherBoard({
        projectId,
        sourceColId,
        destColId,
        sourceIndex,
        destIndex
      })
      dragItemToAnotherColumn({
        sourceColId,
        destColId,
        sourceIndex,
        destIndex
      })
    }
  }

  const visibleGroups = groupByItems.filter(group => {
    if (groupBy === ETaskFilterGroupByType.STATUS && statusIds.length) {
      if (!statusIds.includes('ALL') && !statusIds.includes(group.id)) {
        return false
      }
    }
    return true
  })

  const currentTab = activeMobileTab || visibleGroups[0]?.id || ''

  return (
    <div className="w-full flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Mobile Stage Selector Tabs (< md) */}
      <div className="block md:hidden px-4 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-800">
        <Tabs.Root value={currentTab} onValueChange={setActiveMobileTab}>
          <Tabs.List className="flex gap-2 overflow-x-auto mobile-stage-tabs pb-1">
            {visibleGroups.map(group => (
              <Tabs.Trigger
                key={group.id}
                value={group.id}
                className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors min-h-[44px] flex items-center gap-2 ${
                  currentTab === group.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}>
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color || '#6366f1' }}
                />
                {group.name}
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/20 dark:bg-black/20">
                  {group.items?.length || 0}
                </span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </div>

      {/* Main Board View: Tabbed column on mobile (< md), horizontal scroll on desktop (>= md) */}
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="all-columns" direction="horizontal" type="column">
          {provided => (
            <div
              className="board-container flex-1 overflow-x-auto overflow-y-auto custom-scrollbar p-2 md:p-4 flex flex-col md:flex-row gap-4 w-full"
              {...provided.droppableProps}
              ref={provided.innerRef}>
              {visibleGroups.map((group, groupIndex) => {
                const isMobileVisible = currentTab === group.id
                return (
                  <div
                    key={group.id}
                    className={`${
                      isMobileVisible ? 'block' : 'hidden'
                    } md:block w-full md:w-[320px] shrink-0`}>
                    <BoardColumnDraggable group={group} groupIndex={groupIndex} />
                  </div>
                )
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  )
}

