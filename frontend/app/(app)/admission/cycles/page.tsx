'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi, academicYearsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate } from '@/lib/utils'
import { Plus, Trash2, Loader2, ShieldOff, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

export default function AdmissionCyclesPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const qc = useQueryClient()

  const [showAdd, setShowAdd] = useState(false)
  const [academicYearId, setAcademicYearId] = useState('')
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [notes, setNotes] = useState('')

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })

  const { data: cycles, isLoading } = useQuery({
    queryKey: ['admission-cycles'],
    queryFn: () => admissionApi.cycles.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => admissionApi.cycles.create({
      academic_year_id: academicYearId,
      opens_at: opensAt || undefined,
      closes_at: closesAt || undefined,
      notes: notes.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-cycles'] })
      setAcademicYearId(''); setOpensAt(''); setClosesAt(''); setNotes(''); setShowAdd(false)
      toast.success('Admission cycle saved')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save cycle'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => admissionApi.cycles.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-cycles'] })
      toast.success('Cycle removed — admission is unrestricted for that year again')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove cycle'),
  })

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Access Denied"
        description="Only School Admin or Principal can manage admission cycles."
        className="h-64"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admission Cycles"
        description="Open/close admission per academic year. A year with no cycle configured here stays open all year."
        icon={CalendarClock}
        className="mb-0"
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Cycles</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowAdd(v => !v)}>
              <Plus className="h-3.5 w-3.5" /> Add Cycle
            </Button>
          </div>
          <CardDescription className="text-xs">One cycle per academic year — saving again for the same year replaces it.</CardDescription>
        </CardHeader>
        <CardContent>
          {showAdd && (
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-3">
              <div className="min-w-[180px] space-y-1">
                <Label className="text-xs">Academic Year</Label>
                <Select value={academicYearId} onValueChange={setAcademicYearId}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {(years ?? []).map((y: any) => (
                      <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cycle-opens" className="text-xs">Opens</Label>
                <Input id="cycle-opens" type="date" value={opensAt} onChange={e => setOpensAt(e.target.value)} className="w-auto" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cycle-closes" className="text-xs">Closes</Label>
                <Input id="cycle-closes" type="date" value={closesAt} onChange={e => setClosesAt(e.target.value)} className="w-auto" />
              </div>
              <div className="min-w-[180px] flex-1 space-y-1">
                <Label htmlFor="cycle-notes" className="text-xs">Notes</Label>
                <Textarea id="cycle-notes" rows={1} className="resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
              </div>
              <Button
                onClick={() => {
                  if (!academicYearId) return toast.error('Select an academic year')
                  createMutation.mutate()
                }}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <Skeleton className="h-4 w-24 shrink-0" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ))}
            </div>
          ) : !(cycles ?? []).length ? (
            <EmptyState
              icon={CalendarClock}
              title="No cycles configured"
              description="Every academic year is currently open for admission. Add a cycle to restrict one."
              action={<Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add Cycle</Button>}
              className="py-10"
            />
          ) : (
            <div className="divide-y divide-border">
              {(cycles ?? []).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{c.academic_years?.name ?? 'Unknown year'}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.opens_at ? formatDate(c.opens_at) : 'No open date'} — {c.closes_at ? formatDate(c.closes_at) : 'No close date'}
                      {c.notes && <> · {c.notes}</>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(c.id)}
                    aria-label={`Remove cycle for ${c.academic_years?.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
