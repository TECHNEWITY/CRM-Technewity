'use client'

import { useMenuStore } from '@/store/menu'
import { HiOutlineBars3, HiXMark } from 'react-icons/hi2'

export default function HamburgerMenu() {
  const { visible, toggleMenu } = useMenuStore()

  return (
    <div className="flex sm:hidden items-center justify-between py-2 px-4 border-b bg-white dark:bg-gray-900 dark:border-gray-800 sticky top-0 z-30 shadow-sm">
      <button
        type="button"
        onClick={toggleMenu}
        aria-label="Toggle Navigation Menu"
        className="min-w-[44px] min-h-[44px] px-3 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none transition-colors">
        {visible ? (
          <HiXMark className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        ) : (
          <HiOutlineBars3 className="w-5 h-5" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider">
          Menu
        </span>
      </button>
    </div>
  )
}

