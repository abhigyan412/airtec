'use client'
import { MessageSquareWarning } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePrincipalDashboard } from '@/lib/usePrincipalDashboard'

// Unresolved complaints grouped by class/section, worst first — enough
// to spot a class with a cluster of open issues without opening the
// full operational Complaints page.
export function ComplaintsByClass() {
  const { data, isLoading } = usePrincipalDashboard()
  const rows = data?.staff_oversight.complaints_by_class ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareWarning className="h-4 w-4 text-muted-foreground" /> Unresolved Complaints by Class
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">Where open complaints are concentrated</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={MessageSquareWarning} title="No unresolved complaints 🎉" className="py-12" />
        ) : (
          <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
            {rows.map((r, i) => (
              <div key={`${r.class_name}::${r.section_name}::${i}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
                <p className="text-sm font-medium text-foreground">{r.class_name} {r.section_name}</p>
                <Badge variant={r.count >= 4 ? 'destructive' : r.count >= 2 ? 'warning' : 'secondary'}>{r.count} open</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
