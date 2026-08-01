'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, X, Loader2, ShieldOff, GraduationCap } from 'lucide-react'
import { teacherApi, classesApi, academicYearsApi, hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// Who teaches which section+subject isn't managed here — that's read
// straight off the timetable (see getTeacherContext on the backend), so
// building the timetable is the only step needed for it to show up on a
// teacher's own dashboard. This page is only for the one thing that
// genuinely needs its own assignment: who's the homeroom ("class")
// teacher for a section, this academic year.
export default function TeachingAssignmentsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const qc = useQueryClient()

  const { data: academicYears } = useQuery({ queryKey: ['academic-years'], queryFn: () => academicYearsApi.list().then(r => r.data), enabled: canManage })
  const currentYear = (academicYears ?? []).find((ay: any) => ay.is_current) ?? (academicYears ?? [])[0]

  const { data: teachers } = useQuery({
    queryKey: ['staff-teachers'],
    queryFn: () => hrmsApi.staff.list({ role: 'teacher', limit: 200 }).then(r => r.data),
    enabled: canManage,
  })
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => classesApi.list().then(r => r.data), enabled: canManage })

  const { data: classTeacherRows, isLoading: ctLoading } = useQuery({
    queryKey: ['class-teacher-assignments', currentYear?.id],
    queryFn: () => teacherApi.classTeacherAssignments.list({ academic_year_id: currentYear?.id }).then(r => r.data),
    enabled: canManage && !!currentYear,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['class-teacher-assignments'] })

  const removeCT = useMutation({
    mutationFn: (id: string) => teacherApi.classTeacherAssignments.remove(id),
    onSuccess: () => { invalidate(); toast.success('Class teacher assignment ended') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove assignment'),
  })

  const [showAddCT, setShowAddCT] = useState(false)

  const sections = (classes ?? []).flatMap((c: any) => (c.sections ?? []).map((s: any) => ({ ...s, class_name: c.name })))

  if (!canManage) {
    return <EmptyState icon={ShieldOff} title="Access Denied" description="Only School Admin or Principal can manage class teachers." className="h-64" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class Teachers"
        description={currentYear ? `Homeroom assignments for ${currentYear.name}` : 'Homeroom assignments'}
        icon={GraduationCap}
        actions={
          <Button size="sm" onClick={() => setShowAddCT(true)} disabled={!currentYear}>
            <Plus className="h-4 w-4" /> Assign
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Class Teachers</CardTitle>
          <p className="text-xs text-muted-foreground">The one section each teacher is responsible for as homeroom teacher. Subject-teaching itself follows the timetable automatically.</p>
        </CardHeader>
        <CardContent>
          {ctLoading ? (
            <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
          ) : (classTeacherRows ?? []).length === 0 ? (
            <EmptyState icon={GraduationCap} title="No class teachers assigned yet" className="py-8" />
          ) : (
            <div className="divide-y divide-border">
              {classTeacherRows.map((row: any) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">{row.users?.full_name}</p>
                    <p className="text-xs text-muted-foreground">{row.sections?.classes?.name} {row.sections?.name}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => confirm(`End ${row.users?.full_name}'s class teacher assignment?`) && removeCT.mutate(row.id)}
                    aria-label="Remove assignment">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showAddCT && currentYear && (
        <AssignClassTeacherModal
          teachers={teachers ?? []}
          sections={sections}
          academicYearId={currentYear.id}
          onClose={() => setShowAddCT(false)}
          onSaved={() => { setShowAddCT(false); invalidate() }}
        />
      )}
    </div>
  )
}

function AssignClassTeacherModal({ teachers, sections, academicYearId, onClose, onSaved }: {
  teachers: any[]; sections: any[]; academicYearId: string; onClose: () => void; onSaved: () => void
}) {
  const [teacherId, setTeacherId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!teacherId || !sectionId) return toast.error('Select a teacher and a section')
    setLoading(true)
    try {
      await teacherApi.classTeacherAssignments.create({ teacher_id: teacherId, section_id: sectionId, academic_year_id: academicYearId })
      toast.success('Class teacher assigned')
      onSaved()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign class teacher')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Assign Class Teacher</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Select value={teacherId || undefined} onValueChange={setTeacherId}>
            <SelectTrigger><SelectValue placeholder="Select teacher..." /></SelectTrigger>
            <SelectContent>{teachers.map(t => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sectionId || undefined} onValueChange={setSectionId}>
            <SelectTrigger><SelectValue placeholder="Select section..." /></SelectTrigger>
            <SelectContent>{sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.class_name} {s.name}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Replaces any existing class teacher for this section, and ends this teacher&apos;s previous homeroom assignment for the year, if any.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
