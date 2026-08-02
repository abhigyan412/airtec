'use client'
import Link from 'next/link'
import { Wallet, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatDate, formatCurrency } from '@/lib/utils'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'

// Only ever rendered for a class teacher — homeroom_followups is null for
// a subject-only teacher, in which case this renders nothing at all.
export function HomeroomFollowups() {
  const { data, isLoading } = useTeacherDashboard()

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />
  const followups = data?.homeroom_followups
  if (!followups) return null

  const sectionLabel = data?.header?.homeroom_section
    ? `${data.header.homeroom_section.class_name} ${data.header.homeroom_section.section_name}`
    : 'your homeroom'
  const { top, remaining_count, remaining_total } = followups.fee_dues

  return (
    <Card>
      <CardHeader>
        <CardTitle>Homeroom Follow-ups</CardTitle>
        <p className="text-xs text-muted-foreground">For {sectionLabel} only</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Pending fee dues</p>
          </div>
          {top.length === 0 ? (
            <EmptyState icon={Wallet} title={`No pending fees in ${sectionLabel}`} className="py-6" />
          ) : (
            <div className="space-y-1.5">
              {top.map(f => (
                <Link
                  key={f.student_id}
                  href={`/students/${f.student_id}/fees`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <p className="text-sm text-foreground">{f.first_name} {f.last_name}</p>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-destructive">{formatCurrency(f.amount_overdue)}</p>
                    <p className="text-xs text-muted-foreground">{f.days_overdue}d overdue</p>
                  </div>
                </Link>
              ))}
              {remaining_count > 0 && (
                // Points at the dedicated full-list page (GET
                // /teacher/homeroom-fee-dues), not /fees/arrears — that
                // one needs fee.view, which a class teacher doesn't hold,
                // and isn't scoped to just this section.
                <Link
                  href="/fees/homeroom"
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <span>+{remaining_count} more student{remaining_count > 1 ? 's' : ''}</span>
                  <span className="font-semibold">{formatCurrency(remaining_total)}</span>
                </Link>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">TC requests</p>
          {followups.tc_requests.length === 0 ? (
            <EmptyState icon={FileText} title="No TC requests pending" className="py-6" />
          ) : (
            <div className="space-y-2">
              {followups.tc_requests.map(tc => (
                <Link
                  key={tc.id}
                  href={`/students/${tc.students.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{tc.students.first_name} {tc.students.last_name}</p>
                    <p className="text-xs text-muted-foreground">{tc.students.admission_number} · {tc.reason}</p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">{formatDate(tc.created_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
