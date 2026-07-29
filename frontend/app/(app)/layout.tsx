
'use client'
import { useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuth, NON_STAFF_ROLES } from '@/lib/auth'

const FAMILY_APP_URL = process.env.NEXT_PUBLIC_FAMILY_APP_URL ?? 'http://localhost:3001'

// Single shared layout for every authenticated route (route group —
// adds no URL segment). Previously every feature folder declared its
// own copy of this Sidebar+main wrapper, and nested routes (e.g.
// students/[id]/fees) inherited layouts from every ancestor folder
// that also had one — stacking 2-3 real <Sidebar/> instances and
// compounding the left padding 2-3x, which is what produced the huge
// gap between the sidebar and content on deeper pages.
//
// This is staff admin tooling. Parents/students now live in a fully
// separate app (frontend-portal) with its own login — if one somehow
// ends up here (e.g. an old bookmark), send them to the real app via
// a full navigation, not a Next.js route (it's a different origin).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading && user && NON_STAFF_ROLES.includes(user.role)) {
      window.location.href = FAMILY_APP_URL
    }
  }, [isLoading, user])

  if (!isLoading && user && NON_STAFF_ROLES.includes(user.role)) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="pl-[220px]">
        <div className="p-8 max-w-[1400px]">
          {children}
        </div>
      </main>
    </div>
  )

}
