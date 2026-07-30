import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from '@/components/toaster'
import { Providers } from '@/components/providers'
import { ServiceWorkerRegister } from '@/components/service-worker-register'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: { default: 'AIRTEC Family', template: '%s · AIRTEC Family' },
  description: 'Attendance, fees, homework, timetable, and exam results for your child.',
  applicationName: 'AIRTEC Family',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    // Matches manifest short_name: the iOS home-screen label, kept short so it
    // doesn't clip.
    title: 'Family',
  },
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  // Two entries so the browser chrome matches the theme instead of staying
  // indigo-on-black when the phone is in dark mode. Values mirror the
  // --background token in globals.css for each scheme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9ff' },
    { media: '(prefers-color-scheme: dark)', color: '#030712' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Parents open this on a phone; let the layout run under the notch/home
  // indicator rather than letterboxing it.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jakarta.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
