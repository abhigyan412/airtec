'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { ADMISSION_DOC_TYPES as DOC_TYPES } from '@/lib/admissionDocumentTypes'
import { FileCheck2, ShieldOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

export default function DocumentRequirementsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin'
  const classStyle = useClassDisplayStyle()
  const qc = useQueryClient()
  const [classId, setClassId] = useState('')

  const { data: classes } = useQuery({
    queryKey: ['admission-classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: requirements, isLoading } = useQuery({
    queryKey: ['document-requirements', classId],
    queryFn: () => admissionApi.documentRequirements.list(classId).then(r => r.data),
    enabled: !!classId,
  })

  const requiredTypes = new Set((requirements ?? []).map((r: any) => r.document_type))

  const addMutation = useMutation({
    mutationFn: (document_type: string) => admissionApi.documentRequirements.create({ class_id: classId, document_type }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document-requirements', classId] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add'),
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => admissionApi.documentRequirements.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document-requirements', classId] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  const toggle = (docType: string) => {
    if (requiredTypes.has(docType)) {
      const row = (requirements ?? []).find((r: any) => r.document_type === docType)
      if (row) removeMutation.mutate(row.id)
    } else {
      addMutation.mutate(docType)
    }
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Access Denied"
        description="Only School Admin can manage document requirements."
        className="h-64"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Requirements"
        description="Mandatory documents per class. A class with nothing checked here never blocks admission on missing paperwork — this is opt-in, not a default requirement."
        icon={FileCheck2}
        className="mb-0"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Choose a class</CardTitle>
          <CardDescription className="text-xs">The checklist below applies at the final approval step for applications to this class.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select a class" /></SelectTrigger>
            <SelectContent>
              {(classes ?? []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{classLabel(c.name, c.numeric_level, classStyle)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {classId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Required documents</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {DOC_TYPES.map(t => {
                  const active = requiredTypes.has(t.value)
                  const pending = addMutation.isPending || removeMutation.isPending
                  return (
                    <Button
                      key={t.value}
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      size="sm"
                      disabled={pending}
                      onClick={() => toggle(t.value)}
                    >
                      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {t.label}
                    </Button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
