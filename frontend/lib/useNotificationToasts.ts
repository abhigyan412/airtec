'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { notificationsApi } from './api'
import { useAuth } from './auth'

// ── Toast a notification the moment it lands ────────────────────────
//
// Push covers the closed app; this covers the open one. Someone looking
// at the timetable when their cover assignment arrives should not have to
// notice a badge quietly increment — and in a desktop browser with
// notifications denied, a toast is the only thing that will ever tell
// them.
//
// Polling rather than a socket, deliberately. The badge already polls on
// the same interval, the notifications table is the only source, and a
// socket would mean Supabase Realtime with its own RLS surface and
// reconnect handling for a payload that is at most a few rows a day. If
// the volume ever justifies it, this hook is the single seam to swap:
// nothing else in the app reads notifications this way.
//
// The bell's own list query is `enabled: open`, so it cannot serve this —
// it fetches nothing until somebody opens the panel. Hence a second,
// always-on query with its own key.

/** Matches the badge, so the two never disagree by more than a tick. */
const POLL_MS = 60_000

/**
 * How many toasts one tick may raise.
 *
 * Coming back to a laptop after a two-hour meeting can surface a dozen
 * new rows at once, and a dozen stacked toasts is a wall to be dismissed
 * rather than information. The rest stay in the panel, where the badge
 * count already points.
 */
const MAX_PER_TICK = 3

/** Per-user, so two accounts on one browser don't inherit each other's mark. */
const seenKey = (userId: string) => `airtec_notif_seen_${userId}`

function readSeen(userId: string): string | null {
  try { return localStorage.getItem(seenKey(userId)) } catch { return null }
}

function writeSeen(userId: string, iso: string) {
  try { localStorage.setItem(seenKey(userId), iso) } catch { /* private mode */ }
}

type Notification = {
  id: string
  title: string
  message: string
  link: string | null
  is_read: boolean
  created_at: string
}

export function useNotificationToasts() {
  const router = useRouter()
  const qc = useQueryClient()
  const { user } = useAuth()

  /**
   * The newest notification this browser has already accounted for.
   *
   * Held in a ref as well as localStorage because a single render pass
   * must not toast the same row twice, and because the first load has to
   * establish a baseline WITHOUT toasting: a fresh login would otherwise
   * replay every unread notification of the last week as a toast storm.
   */
  const highWater = useRef<string | null>(null)
  const seeded = useRef(false)

  const { data } = useQuery({
    queryKey: ['notifications-toast-poll'],
    queryFn: () => notificationsApi.list({ limit: 10 }).then(r => r.data),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    // A failed poll is not worth a retry storm; the next tick is 60s away.
    retry: false,
    // No signed-in user means every poll is a 401, once a minute forever.
    enabled: !!user?.id,
  })

  useEffect(() => {
    const rows: Notification[] = Array.isArray(data) ? data : (data?.data ?? data?.notifications ?? [])
    if (!rows.length) return

    const userId = user?.id
    if (!userId) return

    // Newest first is what the API returns; sort defensively rather than
    // trust it, because "newest" is the whole basis of the comparison.
    const sorted = [...rows].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const newest = sorted[0].created_at

    if (!seeded.current) {
      // First successful poll of this session. Anything already on the
      // server predates the user opening the app, so it is history, not
      // news — adopt the stored mark, or the newest row if there is none.
      highWater.current = readSeen(userId) ?? newest
      seeded.current = true
      writeSeen(userId, highWater.current)
      // Fall through: a stored mark older than these rows means genuinely
      // new notifications arrived while the app was closed, and those
      // should still be announced.
    }

    const mark = highWater.current
    const fresh = sorted.filter(n =>
      !n.is_read && (!mark || new Date(n.created_at).getTime() > new Date(mark).getTime()))
    if (!fresh.length) return

    // Oldest of the batch first, so the stack reads in the order things
    // actually happened.
    for (const n of fresh.slice(0, MAX_PER_TICK).reverse()) {
      toast(n.title, {
        description: n.message,
        duration: 8000,
        // Tapping a notification should land on the thing it is about,
        // and mark it read on the way — the same contract as tapping it
        // in the panel, and as tapping the native push.
        action: n.link
          ? {
              label: 'View',
              onClick: () => {
                notificationsApi.markRead(n.id)
                  .then(() => {
                    qc.invalidateQueries({ queryKey: ['notifications-unread-count'] })
                    qc.invalidateQueries({ queryKey: ['notifications-list'] })
                  })
                  .catch(() => { /* navigation matters more than the flag */ })
                router.push(n.link!)
              },
            }
          : undefined,
      })
    }

    if (fresh.length > MAX_PER_TICK) {
      toast(`${fresh.length - MAX_PER_TICK} more notifications`, {
        description: 'Open the bell to see the rest.',
        duration: 6000,
      })
    }

    // Advance past the whole batch, including the ones not shown, so the
    // suppressed remainder is not re-toasted on the next tick.
    highWater.current = newest
    writeSeen(userId, newest)
  }, [data, qc, router, user?.id])
}
