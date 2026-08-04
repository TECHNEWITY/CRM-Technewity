// app/layout.tsx
import './global.css'
import './darkmode.css'
import './style/index.css'
import { Inter } from 'next/font/google'
import RootLayoutComp from '../layouts/RootLayout'
import { GoalieProvider } from '@auth-client'

import dynamic from 'next/dynamic'
import GoogleAnalytics from './_components/GA'
import { CSPostHogProvider } from './providers'

const inter = Inter({ subsets: ['latin'] })

const PostHogPageView = dynamic(() => import('./PostHogPageView'), {
  ssr: false,
})

const PushNotification = dynamic(
  () => import('./_components/PushNotification'),
  { ssr: false }
)

export const metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || 'Technewity Labs',
  description: 'Technewity Labs - Enterprise Project & Organization Management System',
  icons: {
    icon: '/logo71x71.png',
    shortcut: '/logo71x71.png',
    apple: '/logo71x71.png'
  }
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <CSPostHogProvider>
      <GoalieProvider>
        <html lang="en">
          <head>
            <title>{process.env.NEXT_PUBLIC_APP_NAME || 'Technewity Labs'}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
            <link rel="icon" href="/logo71x71.png" type="image/png" sizes="any" />
            <link rel="shortcut icon" href="/logo71x71.png" type="image/png" />
            <link rel="apple-touch-icon" href="/logo71x71.png" />
          </head>
          <body className={inter.className}>
            <PostHogPageView />
            <RootLayoutComp>{children}</RootLayoutComp>
            <PushNotification />
            <GoogleAnalytics />
          </body>
        </html>
      </GoalieProvider>
    </CSPostHogProvider>
  )
}
