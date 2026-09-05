'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkflowStepEditor, WorkflowStepForm, WorkflowStepPreset } from './WorkflowStepEditor'

// A collapsed-by-default settings card that reconfigures one editable
// approval chain — GET/PUT a {role_id, action_name}[] step list against
// `apiPath`, same shape every workflow built on the shared engine
// (workflow_definitions/workflow_steps) exposes. Originally the exam
// module's own Publish Workflow tab, now reused for every other module's
// workflow (Admission Approval, Entrance Result Publishing, Transfer
// Certificate, HRMS's Leave/Exit/Regularization/Comp-Off) so this card
// shell only needs to exist once. `canManage` is the caller's own check
// (a role or a permission code — this varies per module), since only
// who's allowed to reconfigure the step list differs, not the mechanics.
export function WorkflowSettingsCard({ title, description, queryKey, apiPath, canManage, minSteps = 1, presets }: {
  title: string
  description: string
  queryKey: string
  apiPath: string
  canManage: boolean
  minSteps?: number
  presets?: WorkflowStepPreset[]
}) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [steps, setSteps] = useState<WorkflowStepForm[] | null>(null)
  const [dirty, setDirty] = useState(false)

  const { data: workflow, isLoading: workflowLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => api.get(apiPath).then(r => r.data.data),
    enabled: expanded,
  })
  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => api.get('/rbac/roles').then(r => r.data.data as any[]),
    enabled: expanded,
  })

  const savedSteps: WorkflowStepForm[] = (workflow?.steps ?? []).map((s: any) => ({ role_id: s.role_id, action_name: s.action_name }))
  const currentSteps = steps ?? savedSteps
  const editable = workflow?.editable !== false
  const canSave = currentSteps.length >= minSteps && currentSteps.every(s => s.role_id && s.action_name.trim())

  const saveMutation = useMutation({
    mutationFn: () => api.put(apiPath, { steps: currentSteps }),
    onSuccess: () => {
      toast.success('Workflow saved — this applies the next time one starts.')
      setDirty(false); setSteps(null)
      qc.invalidateQueries({ queryKey: [queryKey] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save workflow'),
  })

  const update = (next: WorkflowStepForm[]) => { setSteps(next); setDirty(true) }

  return (
    <Card>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {workflowLoading || rolesLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <>
              {!editable && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
                  Something is currently mid-approval on this workflow — finish or reject that first before changing the steps.
                </div>
              )}
              <WorkflowStepEditor steps={currentSteps} onChange={update} roles={roles ?? []} editable={editable && canManage} minSteps={minSteps} presets={presets} />
              {canManage && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!editable || !dirty || !canSave || saveMutation.isPending}>
                    {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
