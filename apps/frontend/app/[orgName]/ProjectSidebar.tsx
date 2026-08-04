'use client'

import { usePathname } from 'next/navigation'
import UserSection from '../../layouts/UserSection'
import {
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiXMark,
} from 'react-icons/hi2'
import { useState, useEffect } from 'react'
import OrgSection from 'apps/frontend/layouts/OrgSection'
import ProjectNavList from '@/features/Project/Nav/List'
import { getLocalCache, setLocalCache } from '@namviek/core/client'
import { useMenuStore } from '@/store/menu'

function ProjectSidebarContainer() {
  const defaultCompactMode = getLocalCache('COMPACT_MENU') || ''
  const [isCompactMode, setCompactMode] = useState(defaultCompactMode === '1')
  const { visible, setVisible } = useMenuStore()
  const pathname = usePathname()

  // Close mobile drawer on route change
  useEffect(() => {
    setVisible(false)
  }, [pathname, setVisible])

  const sidebarClasses = [
    'root-sidebar relative h-screen bg-white dark:bg-gray-900 border-r dark:border-r-gray-800 transition-all duration-300',
    isCompactMode ? 'compact' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {/* Mobile Drawer Overlay Backdrop */}
      {visible && (
        <div
          onClick={() => setVisible(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 sm:hidden transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`${sidebarClasses} ${
          visible
            ? 'fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] shadow-2xl bg-white dark:bg-gray-900 sm:static sm:z-auto sm:w-auto sm:shadow-none'
            : 'hidden sm:flex'
        }`}>
        <nav className="secondary-sidebar flex flex-col h-full w-full relative bg-white dark:bg-gray-900 overflow-y-auto">
          {/* Mobile close button */}
          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label="Close Sidebar"
            className="sm:hidden absolute top-3 right-3 p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[44px] min-h-[44px] flex items-center justify-center z-20">
            <HiXMark className="w-6 h-6" />
          </button>

          {/* Desktop Compact Toggle Button */}
          <div
            onClick={() => {
              setLocalCache('COMPACT_MENU', isCompactMode ? '0' : '1')
              setCompactMode(!isCompactMode)
            }}
            className="hidden sm:block absolute -right-[12px] bottom-[71px] z-10">
            <div className="w-6 h-6 cursor-pointer flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              {isCompactMode ? (
                <HiOutlineChevronRight />
              ) : (
                <HiOutlineChevronLeft />
              )}
            </div>
          </div>

          <OrgSection />
          <ProjectNavList />
          <UserSection />
        </nav>
      </aside>
    </>
  )
}

export default function ProjectSidebar() {
  const pathname = usePathname()

  if (pathname.includes('/sign-in') || pathname.includes('/sign-up')) {
    return null
  }
  return <ProjectSidebarContainer />
}

