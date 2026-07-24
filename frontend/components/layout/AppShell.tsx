'use client'

import * as React from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)

  return (
    // Viewport-locked shell: the outer box is exactly one screen tall and never
    // scrolls, so the sidebar and header stay fixed while ONLY <main> scrolls.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
