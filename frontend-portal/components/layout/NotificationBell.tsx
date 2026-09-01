'use client'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { notificationsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PushPrompt } from './PushPrompt'
import { PushStatus } from './PushStatus'

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

interface NotificationBellProps {
  /**
   * @deprecated Ignored. The bell used to be hand-painted for a dark header and
   * a light one; the shell's header is now themed chrome in both colour schemes,
   * so there is a single tokenised appearance and nothing left to switch on. The
   * prop stays accepted, and unread, so the existing call site keeps compiling.
   */
  variant?: 'dark' | 'light'
}

export function NotificationBell(_props: NotificationBellProps = {}) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const router = useRouter()

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => notificationsApi.unreadCount().then(r => r.data),
    refetchInterval: 60_000,
    // Polling covers the open tab; push covers the closed one. Refetching
    // on focus removes the window where the badge is up to a minute stale.
    refetchOnWindowFocus: true,
  })

  const { data: list, isLoading } = useQuery({
    queryKey: ['notifications-list'],
    queryFn: () => notificationsApi.list({ limit: 15 }).then(r => r.data),
    enabled: open,
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] })
      qc.invalidateQueries({ queryKey: ['notifications-list'] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] })
      qc.invalidateQueries({ queryKey: ['notifications-list'] })
    },
  })

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const count = unread?.count ?? 0
  const notifications: any[] = list ?? []

  const handleClick = (n: any) => {
    if (!n.is_read) markReadMutation.mutate(n.id)
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(o => !o)}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notifications-panel"
        className="relative text-muted-foreground hover:text-foreground [&_svg]:size-[18px]"
      >
        <Bell />
        {count > 0 && (
          <span aria-live="polite" aria-atomic="true"
            className="pointer-events-none absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold tabular-nums text-destructive-foreground">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>

      {open && (
        /* On a phone the panel spans the viewport and hangs off the header, not
           off the button — so its top is the header's own geometry: the h-14 bar
           plus the notch inset it's padded by (`pt-safe`). The old literal
           `top-16` slid under the bar on any phone with a notch. From `sm` up the
           panel anchors to the trigger instead, so sm:h-16 never comes into it. */
        <div ref={panelRef} id="notifications-panel" role="group" aria-labelledby="notifications-panel-title"
          className="fixed left-4 right-4 top-[calc(env(safe-area-inset-top)_+_3.5rem_+_0.5rem)] z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl
            sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px]">
          <div className="flex min-h-[3.25rem] flex-shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
            <h3 id="notifications-panel-title" className="text-sm font-semibold text-foreground">Notifications</h3>
            {count > 0 && (
              // Full 44px target, pulled back into the row's own padding so
              // clearing the list doesn't visibly resize the panel header.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="-my-1 -mr-2 h-11 px-3 text-primary hover:text-primary"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </Button>
            )}
          </div>
          <PushPrompt app="family" copy={{ headline: 'Never miss a fee or absence alert', detail: "Fee reminders, attendance alerts and results for your child — even when the app is closed." }} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              // Same row shape as the real list, so nothing jumps when it lands.
              <div className="divide-y divide-border">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex gap-2.5 px-4 py-3">
                    <Skeleton className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-3/5" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-2.5 w-14" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="Nothing new right now"
                description="Fee reminders, attendance alerts and results appear here as soon as the school posts them."
                className="px-6 py-10"
              />
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((n: any) => (
                  <button key={n.id} onClick={() => handleClick(n)}
                    className={cn('flex w-full min-h-[3.25rem] gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      !n.is_read && 'bg-primary/5')}>
                    <span className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', !n.is_read ? 'bg-primary' : 'bg-transparent')} />
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm leading-tight', !n.is_read ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground/60">{timeAgo(n.created_at)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <PushStatus app="family" />
        </div>
      )}
    </div>
  )
}
