'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { feeApi, admissionApi } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import { PiggyBank, BarChart3 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { QueryError } from '@/components/shared/QueryError'

// Collection meter: single ratio (collected ÷ billed), color-banded by the
// same severity convention used everywhere else in this app (attendance %,
// syllabus coverage) — green ≥75%, amber ≥50%, red below — so "is this
// number good or bad" reads the same way across the whole product without
// the viewer having to learn a new scale for fees specifically.
function CollectionMeter({ stats }: { stats: any }) {
  const billed = stats?.total_billed ?? 0
  const collected = stats?.total_collected ?? 0
  const due = stats?.total_due ?? 0
  const pct = billed > 0 ? Math.round((collected / billed) * 100) : 0
  const ramp = pct >= 75 ? { fill: 'bg-success', track: 'bg-success/15', text: 'text-success' }
    : pct >= 50 ? { fill: 'bg-warning', track: 'bg-warning/15', text: 'text-warning' }
    : { fill: 'bg-destructive', track: 'bg-destructive/15', text: 'text-destructive' }

  return (
    <Card>
      <CardHeader className="space-y-1 pb-0">
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-muted-foreground" /> Collection Health
        </CardTitle>
        <p className="text-xs text-muted-foreground">Collected against total billed this year</p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="mb-2 flex items-end justify-between">
          <span className={cn('text-3xl font-bold tabular-nums', ramp.text)}>{pct}%</span>
          <span className="text-xs tabular-nums text-muted-foreground">of {formatCurrency(billed)} billed</span>
        </div>
        <div className={cn('h-3 overflow-hidden rounded-full', ramp.track)}>
          <div className={cn('h-full rounded-full transition-all', ramp.fill)} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border pt-5">
          <div>
            <p className="text-xs text-muted-foreground">Collected</p>
            <p className="text-lg font-bold tabular-nums text-success">{formatCurrency(collected)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-lg font-bold tabular-nums text-destructive">{formatCurrency(due)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// "All Classes" ranks every class by total outstanding — good for spotting
// where the problem is. Picking one specific class switches to a
// per-STUDENT breakdown within it — the actual actionable list for
// follow-up calls, not just a class-level total. Both modes reuse the
// same GET /fees/dues (it already accepts class_id), just grouped
// differently client-side.
function ClassWiseDues() {
  const [classId, setClassId] = useState('')

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: dues, isLoading, error } = useQuery({
    queryKey: ['fee-dues', classId],
    queryFn: () => feeApi.dues(classId ? { class_id: classId } : undefined).then(r => r.data),
  })

  const byClass = new Map<string, number>()
  for (const d of dues ?? []) {
    const name = d.students?.classes?.name ?? 'Unassigned'
    byClass.set(name, (byClass.get(name) ?? 0) + Number(d.amount_due))
  }
  const classData = Array.from(byClass.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .reverse()

  const byStudent = new Map<string, number>()
  for (const d of dues ?? []) {
    const s = d.students
    const name = s ? `${s.first_name} ${s.last_name}` : 'Unknown'
    byStudent.set(name, (byStudent.get(name) ?? 0) + Number(d.amount_due))
  }
  const studentData = Array.from(byStudent.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .reverse()

  const data = classId ? studentData : classData
  const selectedClassName = (classesData ?? []).find((c: any) => c.id === classId)?.name

  return (
    <Card>
      <CardHeader className="space-y-1 pb-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" /> Outstanding Dues {classId ? `— ${selectedClassName}` : 'by Class'}
          </CardTitle>
          <Select value={classId || 'all'} onValueChange={v => setClassId(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-[140px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{classId ? 'Students to follow up with' : 'Where to focus follow-up'}</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[220px] w-full rounded-xl" />
        ) : error ? (
          <QueryError error={error} title="Could not load the analytics" />
        ) : data.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No outstanding dues 🎉"
            description={classId
              ? 'Every student in this class has cleared their invoices — pick another class to compare.'
              : 'Nothing is unpaid right now. Classes with dues will be ranked here.'}
            className="py-12"
          />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false}
                tickFormatter={(v) => v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={classId ? 90 : 70} />
              <Tooltip
                contentStyle={{
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 12,
                  fontSize: 13,
                  background: 'hsl(var(--popover))',
                  color: 'hsl(var(--popover-foreground))',
                  boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)',
                }}
                cursor={{ fill: 'hsl(var(--muted))' }}
                formatter={(value: any) => [formatCurrency(Number(value)), 'Outstanding']}
              />
              <Bar dataKey="amount" fill="hsl(0 84% 62%)" radius={[0, 6, 6, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function FeeAnalytics({ stats }: { stats: any }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <CollectionMeter stats={stats} />
      <ClassWiseDues />
    </div>
  )
}
