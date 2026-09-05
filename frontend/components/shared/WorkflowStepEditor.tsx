'use client'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

export type WorkflowStepForm = { role_id: string; action_name: string }

export interface WorkflowStepPreset {
  key: string
  label: string
  build: (roles: any[]) => WorkflowStepForm[]
}

// Shared add/remove/reorder/preset editor over a {role_id, action_name}[]
// step list — originally built for the exam module's Result Freeze &
// Publish workflow, then reused by its own per-Term-Template Component
// Release workflow, and now the shared editor behind every other
// module's own editable approval chain (Admission, Transfer Certificate,
// HRMS's Leave/Exit/Regularization/Comp-Off) — all built on the same
// generic engine (workflow_definitions/workflow_steps), so the editing UI
// only needs to exist once. minSteps controls the floor the remove
// button won't go below — 1 for a workflow that must always have at
// least one step, 0 for one where "no workflow at all" is itself a
// valid, meaningful choice (e.g. a component-release fallback).
export function WorkflowStepEditor({ steps, onChange, roles, editable, minSteps = 1, presets }: {
  steps: WorkflowStepForm[]
  onChange: (next: WorkflowStepForm[]) => void
  roles: any[]
  editable: boolean
  minSteps?: number
  presets?: WorkflowStepPreset[]
}) {
  const updateStep = (i: number, patch: Partial<WorkflowStepForm>) => onChange(steps.map((s, j) => j === i ? { ...s, ...patch } : s))
  const addStep = () => onChange([...steps, { role_id: '', action_name: '' }])
  const removeStep = (i: number) => onChange(steps.filter((_, j) => j !== i))
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const applyPreset = (preset: WorkflowStepPreset) => { if (roles) onChange(preset.build(roles)) }

  return (
    <div className="space-y-4">
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Quick setup:</span>
          {presets.map(p => (
            <Button key={p.key} variant="outline" size="sm" disabled={!editable} onClick={() => applyPreset(p)}>
              {p.label}
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{i + 1}</span>
            <Select value={step.role_id || undefined} onValueChange={v => updateStep(i, { role_id: v })} disabled={!editable}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Select role..." /></SelectTrigger>
              <SelectContent>
                {(roles ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="h-9 flex-1" placeholder="Step label, e.g. Verify Results" value={step.action_name}
              onChange={e => updateStep(i, { action_name: e.target.value })} disabled={!editable} />
            <Button variant="ghost" size="icon" className="h-9 w-9" disabled={!editable || i === 0} onClick={() => moveStep(i, -1)} aria-label="Move step up">
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" disabled={!editable || i === steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move step down">
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive"
              disabled={!editable || steps.length <= minSteps} onClick={() => removeStep(i)} aria-label="Remove step">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" disabled={!editable} onClick={addStep}><Plus className="h-3.5 w-3.5" /> Add step</Button>
    </div>
  )
}
