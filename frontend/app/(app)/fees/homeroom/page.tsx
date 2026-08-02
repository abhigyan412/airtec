'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Wallet } from 'lucide-react'
import { teacherApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface FeeDue {
  student_id: string
  first_name: string
  last_name: string
  admission_number: string
  amount_overdue: number
  days_overdue: number
}

// The full list behind "+N more students" on the dashboard's Homeroom
// Follow-ups card, which only ever shows the top 5. Class-teacher only —
// GET /teacher/homeroom-fee-dues 403s for a subject-only teacher rather
// than falling back to the school-wide /fees/arrears page, which needs
// fee.view (a class teacher doesn't hold it) and isn't section-scoped.
export default function HomeroomFeeDuesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-homeroom-fee-dues'],
    queryFn: () => teacherApi.homeroomFeeDues().then(r => r.data as { section_name: string; class_name: string; students: FeeDue[]; total_overdue: number }),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Homeroom Fee Dues"
        description={data ? `${data.class_name} ${data.section_name} — ${data.students.length} student${data.students.length !== 1 ? 's' : ''} with pending fees` : 'Pending fees for your homeroom section'}
        icon={Wallet}
        actions={
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : !data || data.students.length === 0 ? (
        <Card>
          <EmptyState icon={Wallet} title="No pending fees in your homeroom" className="py-14" />
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <p className="text-sm font-medium text-muted-foreground">Total overdue</p>
              <p className="text-xl font-bold text-destructive">{formatCurrency(data.total_overdue)}</p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="divide-y divide-border">
              {data.students.map(f => (
                <Link
                  key={f.student_id}
                  href={`/students/${f.student_id}/fees`}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.first_name} {f.last_name}</p>
                    <p className="text-xs text-muted-foreground">{f.admission_number}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-destructive">{formatCurrency(f.amount_overdue)}</p>
                    <p className="text-xs text-muted-foreground">{f.days_overdue}d overdue</p>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
