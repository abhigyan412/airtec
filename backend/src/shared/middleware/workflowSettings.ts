import { supabase } from '../db/client'

// Generic "let a school reconfigure this approval chain" pair, extracted
// from the exam module's Result Settings -> Publish Workflow tab (the
// first workflow this was ever built for). Every consumer just supplies
// its own workflowName/module/entityType and an idempotent ensure-seed
// function (rbac/seed.ts already has one per workflow) — the actual
// retire-old/insert-new mechanics are identical everywhere, because the
// underlying tables (workflow_definitions/workflow_steps/
// workflow_instances/workflow_approvals) are the same generic engine for
// all of them (see workflow-engine.ts).

export interface WorkflowStepInput {
  role_id: string
  action_name: string
}

export interface EditableWorkflowStatus {
  definition_id: string
  steps: any[]
  editable: boolean
}

async function getActiveDefinition(
  schoolId: string,
  workflowName: string,
  ensureSeedFn: (schoolId: string) => Promise<void>,
) {
  await ensureSeedFn(schoolId)
  const { data } = await supabase
    .from('workflow_definitions')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('name', workflowName)
    .eq('is_active', true)
    .maybeSingle()
  return data
}

/**
 * The step list a school currently has for this workflow, plus whether
 * it's safe to change right now — `editable: false` while any instance
 * of it is mid-approval, since changing the step list out from under a
 * running instance would leave `workflow_instances.current_step_id`
 * pointing at a step that's about to be retired.
 */
export async function getEditableWorkflowStatus(
  schoolId: string,
  workflowName: string,
  ensureSeedFn: (schoolId: string) => Promise<void>,
): Promise<EditableWorkflowStatus | null> {
  const definition = await getActiveDefinition(schoolId, workflowName, ensureSeedFn)
  if (!definition) return null

  const [{ data: steps }, { count: activeCount }] = await Promise.all([
    supabase.from('workflow_steps').select('id, step_order, role_id, action_name, roles ( name )')
      .eq('workflow_id', definition.id).order('step_order'),
    supabase.from('workflow_instances').select('id', { count: 'exact', head: true })
      .eq('workflow_id', definition.id).eq('status', 'in_progress'),
  ])

  return { definition_id: definition.id, steps: steps ?? [], editable: (activeCount ?? 0) === 0 }
}

/**
 * Saves a new step list for this workflow. Never deletes a
 * workflow_steps row — workflow_instances.current_step_id has a plain
 * FK (no ON DELETE) to it, and a rejected instance never nulls that out,
 * so deleting old steps would either hard-fail with an FK violation the
 * moment this workflow has ever run once, or cascade-delete
 * workflow_approvals audit history for entities that already completed
 * it. Instead this retires the current workflow_definitions row (renamed
 * out of the way + is_active:false) and inserts a fresh one under the
 * canonical name — old instances/approvals keep pointing at the
 * untouched old definition/steps forever; startWorkflow's own
 * `.eq('is_active', true)` lookup picks up the new one automatically.
 */
export async function saveEditableWorkflowSteps(
  schoolId: string,
  opts: { workflowName: string; module: string; entityType: string; ensureSeedFn: (schoolId: string) => Promise<void> },
  steps: WorkflowStepInput[],
): Promise<{ success: boolean; error?: string; definition_id?: string; steps?: any[] }> {
  const { workflowName, module, entityType, ensureSeedFn } = opts

  const definition = await getActiveDefinition(schoolId, workflowName, ensureSeedFn)
  if (!definition) return { success: false, error: `Could not load the "${workflowName}" workflow` }

  const { count: activeCount } = await supabase
    .from('workflow_instances').select('id', { count: 'exact', head: true })
    .eq('workflow_id', definition.id).eq('status', 'in_progress')
  if ((activeCount ?? 0) > 0) {
    return { success: false, error: "Can't change the workflow while something is mid-approval on it — finish or reject that first." }
  }

  const roleIds = [...new Set(steps.map(s => s.role_id))]
  const { data: validRoles } = await supabase.from('roles').select('id').eq('school_id', schoolId).in('id', roleIds)
  if ((validRoles ?? []).length !== roleIds.length) {
    return { success: false, error: 'One or more selected roles are invalid for this school.' }
  }

  const retiredName = `${definition.name} (retired ${new Date().toISOString()})`
  const { error: retireErr } = await supabase.from('workflow_definitions')
    .update({ name: retiredName, is_active: false }).eq('id', definition.id)
  if (retireErr) return { success: false, error: retireErr.message }

  const { data: newDefinition, error: defErr } = await supabase
    .from('workflow_definitions')
    .insert({ school_id: schoolId, name: workflowName, module, entity_type: entityType, is_active: true })
    .select('id').single()
  if (defErr || !newDefinition) return { success: false, error: defErr?.message ?? 'Failed to save workflow' }

  const stepRows = steps.map((s, i) => ({
    workflow_id: newDefinition.id, step_order: i + 1, role_id: s.role_id, action_name: s.action_name, is_required: true,
  }))
  const { data: savedSteps, error: stepsErr } = await supabase.from('workflow_steps').insert(stepRows)
    .select('id, step_order, role_id, action_name, roles ( name )')
  if (stepsErr) return { success: false, error: stepsErr.message }

  return { success: true, definition_id: newDefinition.id, steps: savedSteps ?? [] }
}
