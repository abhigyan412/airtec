'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { principalApi } from '@/lib/api'

type Group = { class_id: string; class_name: string; section_id: string | null; section_name: string; count: number }

// Persistent, always visible — students below the school's configurable
// cumulative-attendance threshold for the current academic year. Counts
// only by default (no long name list cluttering the dashboard); "View
// full list" drills into one class+section's actual names on demand.
export function LowAttendancePanel() {
  const [selected, setSelected] = useState<Group | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['principal-low-attendance'],
    queryFn: () => principalApi.lowAttendanceStudents().then(r => r.data),
  })

  const groups: Group[] = data?.groups ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" /> Low Attendance — Below {data?.threshold_pct ?? 60}%
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">Cumulative attendance this academic year, by class &amp; section</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
        ) : groups.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No students below the threshold" className="py-10" />
        ) : (
          <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
            {groups.map((g, i) => (
              <button
                key={i}
                onClick={() => setSelected(g)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60"
              >
                <p className="text-sm font-medium text-foreground">
                  {g.class_name} {g.section_name} — {g.count} student{g.count !== 1 ? 's' : ''}
                </p>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  View full list <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      {selected && <LowAttendanceDetailModal group={selected} onClose={() => setSelected(null)} />}
    </Card>
  )
}

function LowAttendanceDetailModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['principal-low-attendance-detail', group.class_id, group.section_id],
    queryFn: () => principalApi.lowAttendanceStudents({ class_id: group.class_id, section_id: group.section_id ?? undefined }).then(r => r.data),
  })
  const students = data?.students ?? []

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{group.class_name} {group.section_name} — Low Attendance</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
        ) : (
          <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
            {students.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg px-2 py-2">
                <p className="text-sm font-medium text-foreground">{s.first_name} {s.last_name}</p>
                <span className="text-sm font-semibold text-destructive">{s.attendance_pct}%</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
