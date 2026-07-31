'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { House, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { studentsApi } from '@/lib/api'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { BottomTabs } from '@/components/layout/BottomTabs'
import { MoreSheet } from '@/components/layout/MoreSheet'
import { TopNav } from '@/components/layout/TopNav'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Skeleton } from '@/components/ui/skeleton'

// The one authenticated shell in this app — everything under here requires a
// parent/student login (staff logins are already rejected at /auth/login,
// before they ever reach this layout).
//
// Navigation is defined once in components/layout/nav.ts and rendered two ways:
// a bottom tab bar on phones, a top row on desktop. It used to be a single row
// of horizontally-scrolling top tabs, which on a phone put every destination at
// the least reachable edge of the screen and hid half of them off-screen.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && !user) router.replace('/auth/login')
  }, [isLoading, user, router])

  // Belt-and-braces: the sheet's own links close it, but a back gesture out of
  // a pushed route would otherwise leave it hanging open.
  useEffect(() => setMoreOpen(false), [pathname])

  const { data: me } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then((r) => r.data),
    enabled: !!user,
  })

  if (isLoading || !user) return <ShellSkeleton />

  const initials = `${me?.first_name?.[0] ?? ''}${me?.last_name?.[0] ?? ''}`.toUpperCase() || 'S'
  const studentName = me ? `${me.first_name} ${me.last_name}` : user.full_name
  const classLabel = me?.classes?.name
    ? `${me.classes.name}${me.sections?.name ? ` · ${me.sections.name}` : ''}`
    : undefined

  return (
    <div className="min-h-dvh bg-background">
      {/* Translucent chrome the content scrolls under, rather than an opaque bar
          that permanently eats a strip of a phone screen. */}
      <header className="chrome sticky top-0 z-30 border-b pt-safe">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:h-16 sm:px-6">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <House className="h-[18px] w-[18px] text-primary-foreground" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-tight text-foreground">AIRTEC</span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                {(user as any)?.schools?.name ?? 'Family Portal'}
              </span>
            </span>
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <NotificationBell variant="light" />

            {/* Desktop keeps identity and sign-out in the header; on a phone both
                live in the More sheet, where they aren't 30px targets. */}
            <div className="hidden sm:flex sm:items-center sm:gap-2 sm:border-l sm:pl-2">
              <ThemeToggle />
              <div className="flex items-center gap-2 pl-1">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                  {me?.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={me.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[11px] font-bold text-primary">{initials}</span>
                  )}
                </span>
                <span className="hidden min-w-0 md:block">
                  <span className="block max-w-[10rem] truncate text-xs font-semibold leading-tight text-foreground">
                    {studentName}
                  </span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">
                    {classLabel ?? user.role}
                  </span>
                </span>
              </div>
              <button
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Nav gets its own row from `sm` up. Sharing one row with the brand,
            the theme control and the identity block overflowed the 768px
            container: six labelled links alone are ~580px of it. A full-width
            row also means adding a section later can't squeeze anything. */}
        <div className="mx-auto hidden max-w-3xl px-4 pb-2 sm:block sm:px-6">
          <TopNav role={user.role} />
        </div>
      </header>

      {/* pb-tabbar clears the fixed tab bar and the home indicator so the last
          row of every page stays reachable. */}
      <main className="mx-auto max-w-3xl px-4 py-5 pb-tabbar sm:px-6 sm:py-8 sm:pb-8">{children}</main>

      <BottomTabs role={user.role} onMore={() => setMoreOpen(true)} moreOpen={moreOpen} />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        role={user.role}
        student={{ name: studentName, detail: classLabel, initials, photoUrl: me?.photo_url }}
        onSignOut={logout}
      />
    </div>
  )
}

/**
 * Matches the real shell's geometry so nothing jumps into place once auth
 * resolves. The previous version showed centred "Loading..." text, which meant
 * every cold open visibly rebuilt itself.
 */
function ShellSkeleton() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="chrome sticky top-0 z-30 border-b pt-safe">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:h-16 sm:px-6">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="ml-auto h-8 w-8 rounded-full" />
        </div>
      </div>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:px-6 sm:py-8">
        <Skeleton className="h-20 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
      </main>
    </div>
  )
}
