'use client'

import * as React from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)

  return (
    // Viewport-locked shell: the outer box is exactly one screen tall and never
    // scrolls, so the sidebar and header stay fixed while ONLY <main> scrolls.
    //
    // On paper none of that applies. The chrome is dropped, and the height
    // lock and scroll containers are released — a page that is exactly one
    // screen tall and clips its overflow prints as exactly one page with
    // the rest missing, which is how a sixteen-sheet timetable print comes
    // out as a single sheet.
    <div className="flex h-dvh overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <div className="contents print:hidden">
        <Sidebar open={open} onClose={() => setOpen(false)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <div className="contents print:hidden">
          <Header onMenuClick={() => setOpen(true)} />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto w-full max-w-[1440px] p-4 lg:p-6 print:max-w-none print:p-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
