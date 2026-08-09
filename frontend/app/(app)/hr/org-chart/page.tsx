'use client'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { Network, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { HrQuickNav } from '@/components/hr/HrQuickNav'
import { StaffAvatar } from '@/components/hr/StaffAvatar'
import { Skeleton } from '@/components/ui/skeleton'

type StaffNode = {
  id: string
  full_name: string
  designation: string | null
  department: string | null
  reporting_to: string | null
  photo_url: string | null
}

// Basic tree/hierarchy, built client-side from the flat org-chart list —
// staff_profiles.reporting_to has existed since the baseline schema but
// nothing ever rendered it. Not a graphics library, just nested cards;
// "simple" per the original spec.
export default function OrgChartPage() {
  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff-org-chart'],
    queryFn: () => hrmsApi.staff.orgChart().then(r => r.data),
  })

  const list = (staff ?? []) as StaffNode[]
  const byId = new Map(list.map(s => [s.id, s]))
  const byManager = new Map<string, StaffNode[]>()
  for (const s of list) {
    // A manager who isn't in this school's staff list (shouldn't happen,
    // but reporting_to has no referential guard against it) falls back
    // to root rather than vanishing from the tree.
    const key = s.reporting_to && byId.has(s.reporting_to) ? s.reporting_to : '__unset__'
    if (!byManager.has(key)) byManager.set(key, [])
    byManager.get(key)!.push(s)
  }

  const roots = byManager.get('__unset__') ?? []

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/hr/staff" aria-label="Back to staff"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader className="mb-0 flex-1" title="Org Chart" description="Reporting structure, built from each staff member's Reports To field" icon={Network}
          actions={<HrQuickNav current="org-chart" />} />
      </div>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !(staff ?? []).length ? (
            <EmptyState icon={Network} title="No staff yet" description="Once staff are added, their reporting structure appears here." />
          ) : roots.length === 0 ? (
            <EmptyState icon={Network} title="No hierarchy set yet" description="Set a 'Reports To' on staff profiles (Staff Directory → a staff member → Profile) to build the chart." />
          ) : (
            <div className="space-y-1">
              {roots.map(node => <OrgNode key={node.id} node={node} byManager={byManager} depth={0} ancestors={new Set()} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function OrgNode({ node, byManager, depth, ancestors }: { node: StaffNode; byManager: Map<string, StaffNode[]>; depth: number; ancestors: Set<string> }) {
  // Cycle guard: reporting_to is free-text-selected, nothing in the
  // schema prevents A -> B -> A. Stop recursing rather than hang the
  // page if that ever happens.
  if (ancestors.has(node.id)) return null
  const children = byManager.get(node.id) ?? []
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(node.id)

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/50" style={{ marginLeft: depth * 24 }}>
        <StaffAvatar photoUrl={node.photo_url} fullName={node.full_name} className="h-8 w-8 text-xs" />
        <div className="min-w-0">
          <Link href={`/hr/staff/${node.id}`} className="text-sm font-semibold text-foreground hover:underline">{node.full_name}</Link>
          <p className="text-xs text-muted-foreground">{[node.designation, node.department].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      </div>
      {children.map(child => <OrgNode key={child.id} node={child} byManager={byManager} depth={depth + 1} ancestors={nextAncestors} />)}
    </div>
  )
}
