import { supabase } from '../db/client'



export type WorkflowActionStatus = 'approved' | 'rejected' | 'escalated' | 'commented'

interface StartWorkflowParams {
  schoolId: string
  workflowName: string
  entityType: string
  entityId: string
  initiatedBy: string
}

interface StartWorkflowResult {
  success: boolean
  error?: string
  instance?: any
  firstStep?: any
}

/**
 * Creates a workflow_instances row for the given entity, pointing
 * current_step_id at step_order = 1 of the named workflow.
 *
 * If the first step has an auto_approve_condition that's satisfiable
 * with the given entityContext, it auto-records an "approved"
 * workflow_approvals row and advances to the next step (or completes).
 */
export async function startWorkflow(params: StartWorkflowParams & { entityContext?: Record<string, any> }): Promise<StartWorkflowResult> {
  const { schoolId, workflowName, entityType, entityId, initiatedBy, entityContext } = params

  const { data: workflow, error: wfErr } = await supabase
    .from('workflow_definitions')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('name', workflowName)
    .eq('is_active', true)
    .maybeSingle()

  if (wfErr || !workflow) {
    return { success: false, error: `Workflow "${workflowName}" not found or inactive for this school` }
  }

  const { data: steps, error: stepsErr } = await supabase
    .from('workflow_steps')
    .select('id, step_order, role_id, action_name, is_required, auto_approve_condition, roles ( name )')
    .eq('workflow_id', workflow.id)
    .order('step_order')

  if (stepsErr || !steps?.length) {
    return { success: false, error: `Workflow "${workflowName}" has no steps configured` }
  }

  const firstStep = steps[0]

  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .insert({
      school_id: schoolId,
      workflow_id: workflow.id,
      entity_type: entityType,
      entity_id: entityId,
      status: 'in_progress',
      current_step_id: firstStep.id,
      initiated_by: initiatedBy,
    })
    .select()
    .single()

  if (instErr || !instance) {
    return { success: false, error: instErr?.message ?? 'Failed to create workflow instance' }
  }

  // Auto-approve cascade: if the current step's condition is met by entityContext,
  // auto-record approval and advance — repeat until a step requires real action
  // or the workflow completes.
  let current = instance
  let currentStepIndex = 0

  while (entityContext && checkAutoApproveCondition(steps[currentStepIndex]?.auto_approve_condition, entityContext)) {
    const step = steps[currentStepIndex]

    await supabase.from('workflow_approvals').insert({
      workflow_instance_id: current.id,
      workflow_step_id: step.id,
      approved_by: null, // system auto-approval
      status: 'approved',
      notes: 'Auto-approved by workflow condition',
    })

    currentStepIndex++

    if (currentStepIndex >= steps.length) {
      // all steps auto-approved
      const { data: updated } = await supabase
        .from('workflow_instances')
        .update({ status: 'approved', current_step_id: null, completed_at: new Date().toISOString() })
        .eq('id', current.id)
        .select()
        .single()
      current = updated ?? current
      break
    } else {
      const nextStep = steps[currentStepIndex]
      const { data: updated } = await supabase
        .from('workflow_instances')
        .update({ current_step_id: nextStep.id })
        .eq('id', current.id)
        .select()
        .single()
      current = updated ?? current
    }
  }

  return { success: true, instance: current, firstStep: steps[currentStepIndex] ?? null }
}

interface ActOnWorkflowParams {
  instanceId: string
  userId: string
  schoolId: string
  status: WorkflowActionStatus
  notes?: string
}

interface ActOnWorkflowResult {
  success: boolean
  error?: string
  instance?: any
  completed?: boolean
  nextStep?: any
}

/**
 * Records an approval/rejection action on the workflow's CURRENT step,
 * verifying the acting user holds the role required for that step.
 *
 * On 'approved': advances current_step_id to the next step, or marks
 * the instance 'approved' + completed_at if it was the last step.
 *
 * On 'rejected': marks the instance 'rejected' + completed_at immediately
 * (rejection halts the whole workflow — no further steps).
 *
 * 'escalated' / 'commented' just record the approval row without
 * advancing the workflow (for audit trail / discussion).
 */
export async function actOnWorkflow(params: ActOnWorkflowParams): Promise<ActOnWorkflowResult> {
  const { instanceId, userId, schoolId, status, notes } = params

  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .select('id, workflow_id, status, current_step_id, school_id')
    .eq('id', instanceId)
    .eq('school_id', schoolId)
    .single()

  if (instErr || !instance) return { success: false, error: 'Workflow instance not found' }
  if (instance.status !== 'in_progress') return { success: false, error: `Workflow already ${instance.status}` }
  if (!instance.current_step_id) return { success: false, error: 'Workflow has no current step' }

  const { data: currentStep, error: stepErr } = await supabase
    .from('workflow_steps')
    .select('id, step_order, role_id, action_name, roles ( name )')
    .eq('id', instance.current_step_id)
    .single()

  if (stepErr || !currentStep) return { success: false, error: 'Current workflow step not found' }

  // Verify the acting user has the role required for this step
  const { data: userRole, error: roleErr } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('school_id', schoolId)
    .eq('role_id', currentStep.role_id)
    .maybeSingle()

  // School Admin bypass: check if user has the "School Admin" role
  let isSuperUser = false
  if (!userRole) {
    const { data: adminCheck } = await supabase
      .from('user_roles')
      .select('id, roles!inner(name)')
      .eq('user_id', userId)
      .eq('school_id', schoolId)
      .eq('roles.name', 'School Admin')
      .maybeSingle()
    isSuperUser = !!adminCheck
  }

  if (!userRole && !isSuperUser) {
    return { success: false, error: `You don't have the "${(currentStep as any).roles?.name}" role required for this step` }
  }

  // Record the approval/action
  await supabase.from('workflow_approvals').insert({
    workflow_instance_id: instance.id,
    workflow_step_id: currentStep.id,
    approved_by: userId,
    status,
    notes: notes ?? null,
  })

  // Escalated/commented: record only, don't advance
  if (status === 'escalated' || status === 'commented') {
    return { success: true, instance, completed: false }
  }

  // Rejected: halt the whole workflow
  if (status === 'rejected') {
    const { data: updated } = await supabase
      .from('workflow_instances')
      .update({ status: 'rejected', completed_at: new Date().toISOString() })
      .eq('id', instance.id)
      .select()
      .single()
    return { success: true, instance: updated, completed: true }
  }

  // Approved: advance to next step or complete
  const { data: allSteps } = await supabase
    .from('workflow_steps')
    .select('id, step_order')
    .eq('workflow_id', instance.workflow_id)
    .order('step_order')

  const currentIndex = (allSteps ?? []).findIndex(s => s.id === currentStep.id)
  const nextStep = (allSteps ?? [])[currentIndex + 1]

  if (!nextStep) {
    // last step approved -> workflow complete
    const { data: updated } = await supabase
      .from('workflow_instances')
      .update({ status: 'approved', current_step_id: null, completed_at: new Date().toISOString() })
      .eq('id', instance.id)
      .select()
      .single()
    return { success: true, instance: updated, completed: true }
  }

  const { data: updated } = await supabase
    .from('workflow_instances')
    .update({ current_step_id: nextStep.id })
    .eq('id', instance.id)
    .select()
    .single()

  return { success: true, instance: updated, completed: false, nextStep }
}

/**
 * Fetches the full status of a workflow instance for an entity —
 * current step, role required, and full approval history.
 * Useful for rendering a "pipeline progress" UI.
 */
export async function getWorkflowStatus(entityType: string, entityId: string, schoolId: string) {
  const { data: instance } = await supabase
    .from('workflow_instances')
    .select(`
      id, status, started_at, completed_at, workflow_id,
      workflow_definitions ( name ),
      current_step:current_step_id ( id, step_order, action_name, roles ( name ) )
    `)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('school_id', schoolId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
 
  if (!instance) return null
 
  const [{ data: approvals }, { data: allSteps }] = await Promise.all([
    supabase
      .from('workflow_approvals')
      .select('id, status, notes, acted_at, users:approved_by ( full_name ), workflow_steps ( step_order, action_name, roles ( name ) )')
      .eq('workflow_instance_id', (instance as any).id)
      .order('acted_at'),
    supabase
      .from('workflow_steps')
      .select('id, step_order, action_name, roles ( name )')
      .eq('workflow_id', (instance as any).workflow_id)
      .order('step_order'),
  ])
 
  return { ...instance, approvals: approvals ?? [], all_steps: allSteps ?? [] }
}



// ── Internal: evaluate auto_approve_condition JSON against context ──
function checkAutoApproveCondition(condition: any, context: Record<string, any>): boolean {
  if (!condition || !condition.field || !condition.operator) return false

  const value = context[condition.field]
  if (value === undefined) return false

  switch (condition.operator) {
    case '<':  return value < condition.value
    case '<=': return value <= condition.value
    case '>':  return value > condition.value
    case '>=': return value >= condition.value
    case '==': return value == condition.value
    case '!=': return value != condition.value
    default:   return false
  }
}