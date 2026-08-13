'use client'

import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  HiOutlineCheckCircle,
  HiOutlineFolder,
  HiOutlineChartBar,
  HiOutlineVideoCamera,
  HiOutlineStar,
} from 'react-icons/hi2'

export default function MobileBottomNav() {
  const pathname = usePathname()
  const params = useParams()
  const orgSlug = (params?.orgName as string) || ''

  // Do not show on auth pages or when org is not resolved
  if (!orgSlug || pathname.includes('/sign-in') || pathname.includes('/sign-up')) {
    return null
  }

  const basePath = `/${orgSlug}`

  const navItems = [
    {
      label: 'My Works',
      href: `${basePath}/my-works`,
      icon: HiOutlineCheckCircle,
    },
    {
      label: 'Projects',
      href: `${basePath}/project`,
      icon: HiOutlineFolder,
    },
    {
      label: 'Report',
      href: `${basePath}/report`,
      icon: HiOutlineChartBar,
    },
    {
      label: 'Meetings',
      href: `${basePath}/meeting`,
      icon: HiOutlineVideoCamera,
    },
    {
      label: 'Favorites',
      href: `${basePath}/favorites`,
      icon: HiOutlineStar,
    },
  ]

  return (
    <nav
      aria-label="Mobile Navigation"
      className="flex md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 px-2 py-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] shadow-2xl items-center justify-around">
      {navItems.map(item => {
        const isActive = pathname.startsWith(item.href)
        const Icon = item.icon

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex flex-col items-center justify-center min-w-[56px] min-h-[44px] px-2 py-1 rounded-xl text-xs transition-colors ${
              isActive
                ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {isActive && (
              <motion.div
                layoutId="activeTabBadge"
                className="absolute inset-0 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl z-0"
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              />
            )}
            <Icon className="w-5 h-5 z-10 mb-0.5" />
            <span className="text-[10px] leading-tight z-10">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
