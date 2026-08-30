'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import {
  AlertCircle, CheckCircle2, PenLine, BarChart2, Clock, Layers,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface NeedsAttentionItem {
  type: string
  entity_type: 'exam' | 'term'
  id: string
  name: string
  message: string
  href: string
}

interface NeedsAttentionData {
  items: NeedsAttentionItem[]
  counts: Record<string, number>
}

// Fixed display order + per-type icon/heading. Grouping by `type` rather
// than rendering `items` flat keeps related rows (e.g. every exam still
// missing marks) together instead of interleaved by whatever order the
// backend happened to union its five queries in.
const TYPE_CONFIG: Record<string, { label: string; icon: typeof PenLine }> = {
  marks_not_started: { label: 'Marks Not Started', icon: PenLine },
  results_not_generated: { label: 'Results Not Generated', icon: BarChart2 },
  workflow_waiting_on_you: { label: 'Waiting On You', icon: Clock },
  term_ready_to_generate: { label: 'Terms Ready to Generate', icon: Layers },
  term_ready_to_publish: { label: 'Terms Ready to Publish', icon: Layers },
}

export function NeedsAttentionPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['exams-needs-attention'],
    queryFn: () => api.get('/exams/needs-attention').then(r => r.data.data) as Promise<NeedsAttentionData>,
  })

  if (isLoading) {
    return <Skeleton className="h-[104px] rounded-xl" />
  }

  const items = data?.items ?? []
  const counts = data?.counts ?? {}

  if (items.length === 0) {
    return (
      <Card className="flex items-center gap-3 px-6 py-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm text-muted-foreground">All caught up — nothing needs your attention right now.</p>
      </Card>
    )
  }

  const groups = Object.keys(TYPE_CONFIG)
    .map(type => ({ type, rows: items.filter(i => i.type === type) }))
    .filter(g => g.rows.length > 0)

  const totalCount = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0) || items.length

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <CardTitle className="text-base">Needs Your Attention</CardTitle>
        </div>
        <Badge variant="warning">{totalCount}</Badge>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {groups.map(({ type, rows }) => {
          const config = TYPE_CONFIG[type]
          const Icon = config.icon
          const total = counts[type] ?? rows.length
          const remaining = total - rows.length
          return (
            <div key={type}>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {config.label}
              </h4>
              <div className="divide-y divide-border rounded-lg border border-border">
                {rows.map(item => (
                  <Link
                    key={`${item.entity_type}-${item.id}`}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.message}</p>
                    </div>
                  </Link>
                ))}
                {remaining > 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    +{remaining} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
