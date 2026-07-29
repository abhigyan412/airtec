'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth, NON_STAFF_ROLES } from '@/lib/auth'

const FAMILY_APP_URL = process.env.NEXT_PUBLIC_FAMILY_APP_URL ?? 'http://localhost:3001'

// Single shared shell for every authenticated route (route group — adds no URL
// segment). AppShell is a client component holding the responsive sidebar +
// header + mobile-drawer state; mounting it once here is what stops nested
// routes (e.g. students/[id]/fees) from inheriting a layout from every
// ancestor folder and stacking 2-3 real <Sidebar/> instances, which is what
// produced the huge gap between sidebar and content on deeper pages.
//
// This is staff admin tooling. Parents/students now live in a fully separate
// app (frontend-portal) with its own login — if one somehow ends up here (e.g.
// an old bookmark), send them to the real app via a full navigation, not a
// Next.js route (it's a different origin).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const isFamily = !!user && NON_STAFF_ROLES.includes(user.role)

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace('/auth/login')
      return
    }
    if (isFamily) window.location.href = FAMILY_APP_URL
  }, [isLoading, user, isFamily, router])

  // Gate the shell on a settled session. Rendering it while the session
  // is still resolving (or already gone) flashed a fully-chromed
  // dashboard full of empty widgets for a beat before the redirect —
  // every page below fires its queries as soon as it mounts, and with
  // no token they all come back empty.
  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading…</span>
      </div>
    )
  }

  if (!user || isFamily) return null

  return <AppShell>{children}</AppShell>
}
