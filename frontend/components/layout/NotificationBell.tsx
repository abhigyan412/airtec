'use client'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { notificationsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
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

export function NotificationBell({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
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
      <button onClick={() => setOpen(o => !o)}
        className={cn('relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          // 'light' rides the sidebar design tokens, so it stays legible in
          // both themes; 'dark' is the fixed-palette variant for the family
          // portal's dark header.
          variant === 'dark' ? 'text-[#8A8A99] hover:text-white hover:bg-white/[0.06]' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        title="Notifications">
        <Bell className="w-[18px] h-[18px]" />
        {count > 0 && (
          <span aria-live="polite" aria-atomic="true"
            className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef}
          className="fixed left-4 right-4 top-16 z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl
            sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <h3 className="font-semibold text-foreground text-sm">Notifications</h3>
            {count > 0 && (
              <button onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}
                className="flex items-center gap-1 rounded text-xs font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
          <PushPrompt app="staff" copy={{ headline: 'Get notified without checking', detail: 'Leave requests, approvals and fee alerts, even when this tab is closed.' }} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-2.5 px-4 py-3">
                    <Skeleton className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-2.5 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="No notifications yet"
                description="Approvals, fee alerts and announcements land here as they happen."
                className="px-4 py-10"
              />
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((n: any) => (
                  <button key={n.id} onClick={() => handleClick(n)}
                    className={cn('w-full text-left px-4 py-3 hover:bg-accent transition-colors flex gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      !n.is_read && 'bg-primary/5')}>
                    <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', !n.is_read ? 'bg-primary' : 'bg-transparent')} />
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm leading-tight', !n.is_read ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <PushStatus app="staff" />
        </div>
      )}
    </div>
  )
}
