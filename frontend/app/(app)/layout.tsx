'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuth, NON_STAFF_ROLES } from '@/lib/auth'

// Single shared layout for every authenticated route (route group —
// adds no URL segment). Previously every feature folder declared its
// own copy of this Sidebar+main wrapper, and nested routes (e.g.
// students/[id]/fees) inherited layouts from every ancestor folder
// that also had one — stacking 2-3 real <Sidebar/> instances and
// compounding the left padding 2-3x, which is what produced the huge
// gap between the sidebar and content on deeper pages.
//
// This is staff admin tooling — a parent/student landing here would
// see the full students list, class-wide attendance marking, etc.,
// none of which is meant for them (even though the API itself is
// correctly ownership-scoped). Bounce them to their own (portal)
// section instead.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user && NON_STAFF_ROLES.includes(user.role)) {
      router.replace('/portal')
    }
  }, [isLoading, user, router])

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
