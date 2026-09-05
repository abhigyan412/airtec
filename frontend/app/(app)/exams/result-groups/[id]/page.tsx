'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { ArrowLeft, BarChart2, Plus, Trash2, Loader2, RefreshCw, Megaphone, ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { ResultStatusBadge } from '@/components/exams/ResultStatusBadge'

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  draft: 'secondary', result_declared: 'info', result_published: 'success',
}

export default function ResultGroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = usePermissions()
  const canGenerate = can('exam.result_generate')
  const canPublish = can('exam.result_publish')
  const qc = useQueryClient()

  const { data: group, isLoading } = useQuery({
    queryKey: ['result-group', id],
    queryFn: () => api.get(`/exams/result-groups/${id}`).then(r => r.data.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['result-group', id] })

  const generateMutation = useMutation({
    mutationFn: () => api.post(`/exams/result-groups/${id}/generate-results`, {}),
    onSuccess: (r: any) => { toast.success(`Results generated for ${r.data.data.report_cards_generated} students!`); invalidate(); qc.invalidateQueries({ queryKey: ['result-group-results', id] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to generate results'),
  })

  const publishMutation = useMutation({
    mutationFn: () => api.post(`/exams/result-groups/${id}/publish`, {}),
    onSuccess: () => { toast.success('Term results published!'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to publish'),
  })

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="max-w-5xl space-y-6">
        <Button variant="ghost" size="sm" asChild><Link href="/exams/results"><ArrowLeft className="h-4 w-4" /> Back to results</Link></Button>
        <Card><EmptyState icon={BarChart2} title="Term not found" description="This composite term may have been deleted, or the link is out of date." /></Card>
      </div>
    )
  }

  const totalWeight = (group.members ?? []).reduce((s: number, m: any) => s + Number(m.weight_percent), 0)
  const weightsOk = Math.abs(totalWeight - 100) < 0.01
  const membersReady = (group.members ?? []).length > 0 && (group.members ?? []).every((m: any) =>
    ['result_declared', 'result_frozen', 'result_verified', 'result_published'].includes(m.exams?.status))

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground"><Link href="/exams/results"><ArrowLeft className="h-4 w-4" /> Back to results</Link></Button>
        <PageHeader
          title={group.name}
          description={`${group.classes?.name ?? ''} · Composite Term`}
          icon={BarChart2}
          actions={
            <>
              <Badge variant={STATUS_VARIANT[group.status] ?? 'secondary'} className="capitalize">{group.status.replace(/_/g, ' ')}</Badge>
              {canGenerate ? (
                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !weightsOk || !membersReady}
                  className="bg-success text-success-foreground hover:bg-success/90">
                  {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart2 className="h-4 w-4" />}
                  Generate Results
                </Button>
              ) : group.status !== 'result_published' ? (
                <p className="text-xs text-muted-foreground">Waiting on a School Admin or Principal to generate results</p>
              ) : null}
              {group.status === 'result_declared' && (
                canPublish ? (
                  <Button onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
                    {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                    Publish
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Waiting on someone with publish permission</p>
                )
              )}
            </>
          }
        />
      </div>

      {!weightsOk && (
        <p className="text-xs text-warning">Member exam weights currently total {totalWeight}% — they must sum to exactly 100% before results can be generated.</p>
      )}
      {weightsOk && !membersReady && (group.members ?? []).length > 0 && (
        <p className="text-xs text-warning">Every member exam needs its own results generated first (on that exam's own page) before this term can be generated.</p>
      )}

      <MemberExamsSection groupId={id} classId={group.class_id} members={group.members ?? []} onChanged={invalidate} />
      <SubjectsSection groupId={id} subjects={group.subjects ?? []} onChanged={invalidate} />
      <CoscholasticSection groupId={id} />

      {['result_declared', 'result_published'].includes(group.status) && (
        <TermResultsView groupId={id} />
      )}
    </div>
  )
}

function MemberExamsSection({ groupId, classId, members, onChanged }: { groupId: string; classId: string; members: any[]; onChanged: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [examId, setExamId] = useState('')
  const [weight, setWeight] = useState('')
  const qc = useQueryClient()

  const { data: allExams } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get('/exams', { params: { limit: 100 } }).then(r => r.data.data as any[]),
    enabled: showAdd,
  })
  const availableExams = (allExams ?? []).filter(e => !members.some(m => m.exam_id === e.id))

  const addMutation = useMutation({
    mutationFn: () => api.post(`/exams/result-groups/${groupId}/exams`, { exam_id: examId, weight_percent: Number(weight) }),
    onSuccess: () => { toast.success('Exam added'); setShowAdd(false); setExamId(''); setWeight(''); onChanged() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add'),
  })

  const updateWeightMutation = useMutation({
    mutationFn: ({ memberId, weight_percent }: any) => api.patch(`/exams/result-groups/${groupId}/exams/${memberId}`, { weight_percent }),
    onSuccess: () => onChanged(),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update weight'),
  })

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => api.delete(`/exams/result-groups/${groupId}/exams/${memberId}`),
    onSuccess: () => { toast.success('Removed'); onChanged() },
  })

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Member Exams &amp; Weights</h3>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(v => !v)}><Plus className="h-3.5 w-3.5" /> Add Exam</Button>
      </div>

      {showAdd && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-muted/40 p-3">
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label className="text-xs">Exam</Label>
            <Select value={examId || undefined} onValueChange={setExamId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select exam..." /></SelectTrigger>
              <SelectContent>
                {availableExams.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Weight %</Label>
            <Input type="number" min={1} max={100} value={weight} onChange={e => setWeight(e.target.value)} className="h-9 w-24" />
          </div>
          <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !examId || !weight}>
            {addMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add
          </Button>
        </div>
      )}

      {!members.length ? (
        <p className="text-xs text-muted-foreground">No member exams yet — add the exams that make up this term (e.g. Unit Test 1, Unit Test 2, Half Yearly).</p>
      ) : (
        <div className="space-y-2">
          {members.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{m.exams?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{m.exams?.exam_type?.replace(/_/g, ' ')} · {m.exams?.status?.replace(/_/g, ' ')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Input type="number" min={1} max={100} defaultValue={m.weight_percent} className="h-8 w-20"
                  onBlur={e => { const v = Number(e.target.value); if (v && v !== Number(m.weight_percent)) updateWeightMutation.mutate({ memberId: m.id, weight_percent: v }) }} />
                <span className="text-xs text-muted-foreground">%</span>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => removeMutation.mutate(m.id)} aria-label={`Remove ${m.exams?.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function SubjectsSection({ groupId, subjects, onChanged }: { groupId: string; subjects: any[]; onChanged: () => void }) {
  const syncMutation = useMutation({
    mutationFn: () => api.post(`/exams/result-groups/${groupId}/subjects/sync`, {}),
    onSuccess: (r: any) => { toast.success(r.data.added > 0 ? `Added ${r.data.added} subject${r.data.added === 1 ? '' : 's'}` : 'Already up to date'); onChanged() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to sync'),
  })
  const removeMutation = useMutation({
    mutationFn: (subjectId: string) => api.delete(`/exams/result-groups/${groupId}/subjects/${subjectId}`),
    onSuccess: () => onChanged(),
  })

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Subjects</h3>
        <Button variant="ghost" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync from Member Exams
        </Button>
      </div>
      {!subjects.length ? (
        <p className="text-xs text-muted-foreground">No subjects yet — add member exams above, then sync to pull in their subjects.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {subjects.map((s: any) => {
            const isSplit = s.theory_max_marks != null && s.practical_max_marks != null
            return (
              <div key={s.id} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs">
                <span className="font-medium text-foreground">{s.subject_name}</span>
                {isSplit ? (
                  <span className="text-muted-foreground">Th /{s.theory_max_marks} + Pr /{s.practical_max_marks}</span>
                ) : (
                  <span className="text-muted-foreground">/{s.max_marks}</span>
                )}
                <button onClick={() => removeMutation.mutate(s.id)} aria-label={`Remove ${s.subject_name}`} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// Qualitative grades (Discipline, Work Education, ...) graded once per
// Term directly by the class teacher — not tied to any member exam, no
// marks/max-marks concept, never fed into the percentage above. Each
// area's grade_scale (configured in Result Settings -> Co-Scholastic
// Areas, reusing the same exam_grade_scales table scholastic grading
// uses) drives a click-to-select dropdown of that scale's labels; an area
// with no scale configured falls back to a free-text input.
function CoscholasticSection({ groupId }: { groupId: string }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['result-group-coscholastic', groupId],
    queryFn: () => api.get(`/exams/result-groups/${groupId}/coscholastic`).then(r => r.data.data),
  })
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})

  const saveMutation = useMutation({
    mutationFn: ({ studentId, grades }: { studentId: string; grades: { area_id: string; grade_label: string }[] }) =>
      api.put(`/exams/result-groups/${groupId}/coscholastic/${studentId}`, { grades }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['result-group-coscholastic', groupId] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  if (isLoading) return <Card className="p-6"><Skeleton className="h-32 w-full" /></Card>

  const students = data?.students ?? []
  const areas = data?.areas ?? []
  if (!areas.length || !students.length) return null

  const assessmentsByStudent = new Map<string, Map<string, any>>()
  for (const a of data?.assessments ?? []) {
    if (!assessmentsByStudent.has(a.student_id)) assessmentsByStudent.set(a.student_id, new Map())
    assessmentsByStudent.get(a.student_id)!.set(a.area_id, a)
  }

  const valueFor = (studentId: string, areaId: string) =>
    edits[studentId]?.[areaId] ?? assessmentsByStudent.get(studentId)?.get(areaId)?.grade_label ?? ''

  const setValue = (studentId: string, areaId: string, value: string) =>
    setEdits(prev => ({ ...prev, [studentId]: { ...prev[studentId], [areaId]: value } }))

  const saveStudent = (studentId: string) => {
    const grades = areas
      .map((a: any) => ({ area_id: a.id, grade_label: valueFor(studentId, a.id).trim() }))
      .filter((g: any) => g.grade_label)
    if (!grades.length) return
    saveMutation.mutate({ studentId, grades })
  }

  return (
    <Card className="p-5 space-y-3">
      <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Co-Scholastic Grading</h3>
      <p className="text-xs text-muted-foreground">
        Qualitative grades per student — shown on the report card alongside, not inside, the scholastic percentage.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Student</TableHead>
              {areas.map((a: any) => <TableHead key={a.id}>{a.name}</TableHead>)}
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap font-medium text-foreground">{s.first_name} {s.last_name}</TableCell>
                {areas.map((a: any) => {
                  const bands = [...(a.grade_scale?.exam_grade_bands ?? [])].sort((x: any, y: any) => x.sort_order - y.sort_order)
                  return (
                    <TableCell key={a.id}>
                      {bands.length ? (
                        <Select value={valueFor(s.id, a.id) || undefined} onValueChange={v => setValue(s.id, a.id, v)}>
                          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Select..." /></SelectTrigger>
                          <SelectContent>
                            {bands.map((b: any) => <SelectItem key={b.grade_label} value={b.grade_label}>{b.grade_label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input className="h-8 w-20" value={valueFor(s.id, a.id)} onChange={e => setValue(s.id, a.id, e.target.value)} />
                      )}
                    </TableCell>
                  )
                })}
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => saveStudent(s.id)} disabled={saveMutation.isPending}>Save</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

function TermResultsView({ groupId }: { groupId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['result-group-results', groupId],
    queryFn: () => api.get(`/exams/result-groups/${groupId}/results`).then(r => r.data.data as any[]),
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setExpanded(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })

  if (isLoading) return <Card className="space-y-3 p-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</Card>
  const rows = data ?? []
  if (!rows.length) return <Card><EmptyState icon={BarChart2} title="No results yet" description="Generate results above once every member exam has its own results." /></Card>

  const groupMap = new Map<string, { section_name: string; rows: any[] }>()
  for (const rc of rows) {
    const key = rc.students?.section_id ?? 'whole-class'
    if (!groupMap.has(key)) groupMap.set(key, { section_name: rc.students?.sections?.name ?? '', rows: [] })
    groupMap.get(key)!.rows.push(rc)
  }
  const groups = Array.from(groupMap.entries()).map(([key, g]) => ({ key, ...g, rows: g.rows.sort((a, b) => a.rank - b.rank) }))

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-semibold text-foreground">Results — {rows.length} students</h3>
        <div className="text-sm text-muted-foreground">
          Pass: <span className="font-semibold text-success">{rows.filter((r: any) => r.is_pass).length}</span>
          &nbsp; Fail: <span className="font-semibold text-destructive">{rows.filter((r: any) => !r.is_pass).length}</span>
        </div>
      </div>
      <div className="divide-y divide-border">
        {groups.map(g => {
          const isOpen = expanded.has(g.key)
          return (
            <div key={g.key}>
              <button onClick={() => toggle(g.key)} className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-medium text-foreground">{g.section_name || 'Whole class'}</span>
                  <span className="text-xs text-muted-foreground">{g.rows.length} students</span>
                </div>
              </button>
              {isOpen && (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Rank</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Marks</TableHead>
                      <TableHead>Pct</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map((rc: any) => (
                      <TableRow key={rc.id} className="cursor-default">
                        <TableCell className="font-bold text-primary">#{rc.rank}</TableCell>
                        <TableCell className="font-medium text-foreground">{rc.students?.first_name} {rc.students?.last_name}</TableCell>
                        <TableCell className="text-muted-foreground">{rc.obtained_marks}/{rc.total_marks}</TableCell>
                        <TableCell className="font-semibold text-foreground">{rc.percentage}%{rc.overall_cgpa != null && <span className="ml-1 text-xs font-normal text-muted-foreground">· {rc.overall_cgpa} CGPA</span>}</TableCell>
                        <TableCell>{rc.grade ? <Badge variant="secondary">{rc.grade}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                        <TableCell><ResultStatusBadge status={rc.result_status} isPass={rc.is_pass} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
