import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from 'sonner'
import { Providers } from '@/components/providers'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: 'AIRTEC — School ERP',
  description: 'Modern School Management Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jakarta.variable} font-sans antialiased bg-gray-50`}>
        <Providers>
          {children}
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  )
}