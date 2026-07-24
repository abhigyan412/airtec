'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feeApi } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'
import { ArrowLeft, AlertTriangle, Phone, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/shared/EmptyState'

const BUCKET_LABELS: Record<string, { label: string, color: string }> = {
  current: { label: 'Current (Not Due)', color: 'bg-muted text-muted-foreground' },
  '1_30': { label: '1-30 Days', color: 'bg-warning/10 text-warning' },
  '31_60': { label: '31-60 Days', color: 'bg-warning/15 text-warning' },
  '61_90': { label: '61-90 Days', color: 'bg-destructive/10 text-destructive' },
  '90_plus': { label: '90+ Days', color: 'bg-destructive/20 text-destructive' },
}

export default function CollectionsPage() {
  const qc = useQueryClient()
  const [minDays, setMinDays] = useState(30)
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null)

  const { data: aging, isLoading: agingLoading } = useQuery({
    queryKey: ['aging-report'],
    queryFn: () => feeApi.agingReport().then(r => r.data),
  })

  const { data: defaulters, isLoading: defaultersLoading } = useQuery({
    queryKey: ['defaulters', minDays],
    queryFn: () => feeApi.defaulters(minDays).then(r => r.data),
  })

  const lateFineMutation = useMutation({
    mutationFn: () => feeApi.applyLateFines(),
    onSuccess: (res: any) => {
      toast.success(`Late fines updated on ${res.data?.updated ?? 0} overdue invoice(s)`)
      qc.invalidateQueries({ queryKey: ['aging-report'] })
      qc.invalidateQueries({ queryKey: ['defaulters'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const summary = aging?.summary ?? {}
  const bucketOrder = ['current', '1_30', '31_60', '61_90', '90_plus']

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon" className="mt-0.5" aria-label="Back to fees">
            <Link href="/fees"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Collections &amp; Dues</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Aging report, defaulter tracking, and overdue management</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => lateFineMutation.mutate()} disabled={lateFineMutation.isPending}>
          {lateFineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Recalculate Late Fines
        </Button>
      </div>

      {/* Aging buckets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Aging Report</CardTitle>
        </CardHeader>
        <CardContent>
          {agingLoading ? (
            <div className="flex h-20 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {bucketOrder.map(key => {
                const b = summary[key] ?? { count: 0, total: 0 }
                const config = BUCKET_LABELS[key]
                return (
                  <div key={key} className="rounded-xl border border-border p-4">
                    <span className={cn('mb-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold', config.color)}>
                      {config.label}
                    </span>
                    <p className="text-xl font-bold text-foreground">{formatCurrency(b.total)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{b.count} invoice{b.count !== 1 ? 's' : ''}</p>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Defaulters */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> Defaulters ({defaulters?.length ?? 0})
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Overdue by at least</span>
            <Select value={String(minDays)} onValueChange={v => setMinDays(Number(v))}>
              <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any</SelectItem>
                <SelectItem value="15">15 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {defaultersLoading ? (
            <div className="p-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div>
          ) : !(defaulters ?? []).length ? (
            <EmptyState
              icon={AlertTriangle}
              title="No defaulters found 🎉"
              description={`No students overdue by ${minDays}+ days`}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Max Days Overdue</TableHead>
                  <TableHead>Parent Contact</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(defaulters ?? []).map((d: any) => {
                  const isExpanded = expandedStudent === d.student.id
                  return (
                    <>
                      <TableRow key={d.student.id} onClick={() => setExpandedStudent(isExpanded ? null : d.student.id)}>
                        <TableCell className="font-semibold text-foreground">
                          {d.student.first_name} {d.student.last_name}
                          <p className="font-mono text-xs text-muted-foreground">{d.student.admission_number}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.student.classes?.name}{d.student.sections?.name ? ` · ${d.student.sections.name}` : ''}
                        </TableCell>
                        <TableCell className="font-bold text-destructive">{formatCurrency(d.total_outstanding)}</TableCell>
                        <TableCell>
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold',
                            d.max_days_overdue > 90 ? 'bg-destructive/20 text-destructive' :
                            d.max_days_overdue > 60 ? 'bg-destructive/10 text-destructive' :
                            d.max_days_overdue > 30 ? 'bg-warning/15 text-warning' : 'bg-warning/10 text-warning')}>
                            {d.max_days_overdue} days
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.parent_contact?.father_phone && (
                            <span className="flex items-center gap-1 text-xs">
                              <Phone className="h-3 w-3 text-muted-foreground" /> {d.parent_contact.father_phone}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {isExpanded ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${d.student.id}-detail`} className="hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-muted/40">
                            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{d.invoice_count} overdue invoice{d.invoice_count !== 1 ? 's' : ''}</p>
                            <div className="space-y-1.5">
                              {d.invoices.map((inv: any) => (
                                <div key={inv.id} className="flex items-center justify-between text-sm">
                                  <span className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</span>
                                  <span className="text-muted-foreground">{inv.days_overdue} days overdue</span>
                                  <span className="font-semibold text-destructive">{formatCurrency(inv.amount_due)}</span>
                                </div>
                              ))}
                            </div>
                            {d.parent_contact && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {d.parent_contact.father_name} · {d.parent_contact.father_phone}
                                {d.parent_contact.mother_name && ` · ${d.parent_contact.mother_name} · ${d.parent_contact.mother_phone}`}
                              </p>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
