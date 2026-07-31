import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { supabase } from '../../db/client'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../workflow-engine'

// Approval flows are multi-row state machines — an instance, its steps,
// and the approvals recorded against them all have to stay consistent.
// A mock would only assert that this file calls the functions this file
// calls, so these run against a disposable fixture school.

const sb = supabase as any

describe('workflow engine', () => {
  let schoolId: string
  let workflowId: string
  let roleAId: string
  let roleBId: string
  let stepIds: string[] = []
  let userId: string
  const ENTITY = 'fee_discount'

  const newEntityId = () => crypto.randomUUID()

  beforeAll(async () => {
    const { data: school, error } = await sb.from('schools')
      .insert({ name: `__vitest_wf_${Date.now()}` }).select().single()
    if (error) throw new Error(`fixture school: ${error.message}`)
    schoolId = school.id

    const { data: roles } = await sb.from('roles').insert([
      { school_id: schoolId, name: 'WF Approver A', is_system_role: false },
      { school_id: schoolId, name: 'WF Approver B', is_system_role: false },
    ]).select()
    roleAId = roles[0].id; roleBId = roles[1].id

    const email = `__vitest_wf_${Date.now()}@example.com`
    const { data: au } = await sb.auth.admin.createUser({ email, password: 'Test@12345', email_confirm: true })
    userId = au.user.id
    await sb.from('users').insert({ id: userId, school_id: schoolId, full_name: 'WF User', email, role: 'school_admin' })

    // actOnWorkflow verifies the caller holds the current step's role.
    await sb.from('user_roles').insert([
      { user_id: userId, role_id: roleAId, school_id: schoolId },
      { user_id: userId, role_id: roleBId, school_id: schoolId },
    ])

    const { data: wf } = await sb.from('workflow_definitions').insert({
      school_id: schoolId, name: 'Test Approval', module: 'fee', entity_type: ENTITY, is_active: true,
    }).select().single()
    workflowId = wf.id

    const { data: steps } = await sb.from('workflow_steps').insert([
      { workflow_id: workflowId, step_order: 1, role_id: roleAId, action_name: 'First Review', is_required: true },
      { workflow_id: workflowId, step_order: 2, role_id: roleBId, action_name: 'Final Approval', is_required: true },
    ]).select()
    stepIds = steps.sort((a: any, b: any) => a.step_order - b.step_order).map((s: any) => s.id)
  })

  afterAll(async () => {
    const { data: instances } = await sb.from('workflow_instances').select('id').eq('school_id', schoolId)
    for (const i of instances ?? []) await sb.from('workflow_approvals').delete().eq('workflow_instance_id', i.id)
    await sb.from('workflow_instances').delete().eq('school_id', schoolId)
    // Every definition this suite created, not just the main one: the
    // auto-approve cases build ad-hoc workflows, and their steps hold an
    // FK on the fixture roles — leaving one behind makes the role delete
    // below fail silently and strands the whole fixture school, which
    // then trips the live-data invariant suite.
    const { data: defs } = await sb.from('workflow_definitions').select('id').eq('school_id', schoolId)
    for (const d of defs ?? []) {
      await sb.from('workflow_steps').delete().eq('workflow_id', d.id)
    }
    await sb.from('workflow_definitions').delete().eq('school_id', schoolId)
    await sb.from('user_roles').delete().eq('user_id', userId)
    await sb.from('users').delete().eq('id', userId)
    await sb.auth.admin.deleteUser(userId).catch(() => {})
    await sb.from('roles').delete().eq('school_id', schoolId)
    await sb.from('schools').delete().eq('id', schoolId)
  })

  describe('startWorkflow', () => {
    it('creates an instance pointing at the first step', async () => {
      const entityId = newEntityId()
      const r = await startWorkflow({
        schoolId, workflowName: 'Test Approval', entityType: ENTITY, entityId, initiatedBy: userId,
      })
      expect(r.success).toBe(true)
      expect(r.instance.status).toBe('in_progress')
      expect(r.instance.current_step_id).toBe(stepIds[0])
    })

    it('refuses an unknown workflow name rather than silently doing nothing', async () => {
      const r = await startWorkflow({
        schoolId, workflowName: 'Does Not Exist', entityType: ENTITY, entityId: newEntityId(), initiatedBy: userId,
      })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/not found or inactive/)
    })

    it('refuses an inactive workflow', async () => {
      const { data: wf } = await sb.from('workflow_definitions').insert({
        school_id: schoolId, name: 'Inactive Flow', module: 'fee', entity_type: ENTITY, is_active: false,
      }).select().single()
      try {
        const r = await startWorkflow({
          schoolId, workflowName: 'Inactive Flow', entityType: ENTITY, entityId: newEntityId(), initiatedBy: userId,
        })
        expect(r.success).toBe(false)
      } finally {
        await sb.from('workflow_definitions').delete().eq('id', wf.id)
      }
    })

    it('refuses a workflow with no steps configured', async () => {
      const { data: wf } = await sb.from('workflow_definitions').insert({
        school_id: schoolId, name: 'Stepless', module: 'fee', entity_type: ENTITY, is_active: true,
      }).select().single()
      try {
        const r = await startWorkflow({
          schoolId, workflowName: 'Stepless', entityType: ENTITY, entityId: newEntityId(), initiatedBy: userId,
        })
        expect(r.success).toBe(false)
        expect(r.error).toMatch(/no steps/)
      } finally {
        await sb.from('workflow_definitions').delete().eq('id', wf.id)
      }
    })
  })

  describe('auto-approve conditions', () => {
    let autoWorkflowId: string

    const startWithContext = async (condition: any, context: Record<string, any>) => {
      const { data: wf } = await sb.from('workflow_definitions').insert({
        school_id: schoolId, name: `Auto ${crypto.randomUUID().slice(0, 8)}`,
        module: 'fee', entity_type: ENTITY, is_active: true,
      }).select().single()
      autoWorkflowId = wf.id
      const { data: created } = await sb.from('workflow_steps').insert([
        { workflow_id: wf.id, step_order: 1, role_id: roleAId, action_name: 'Auto Step', is_required: true, auto_approve_condition: condition },
        { workflow_id: wf.id, step_order: 2, role_id: roleBId, action_name: 'Manual Step', is_required: true },
      ]).select()
      const ordered = created.sort((a: any, b: any) => a.step_order - b.step_order)
      const result = await startWorkflow({
        schoolId, workflowName: wf.name, entityType: ENTITY, entityId: newEntityId(),
        initiatedBy: userId, entityContext: context,
      })
      return { ...result, step1: ordered[0].id, step2: ordered[1].id }
    }

    afterEachCleanup()

    function afterEachCleanup() {
      beforeEach(async () => {
        if (autoWorkflowId) {
          await sb.from('workflow_steps').delete().eq('workflow_id', autoWorkflowId)
          await sb.from('workflow_definitions').delete().eq('id', autoWorkflowId)
          autoWorkflowId = ''
        }
      })
    }

    it('auto-advances past the first step when the condition holds', async () => {
      const r = await startWithContext({ field: 'amount', operator: '<', value: 1000 }, { amount: 500 })
      expect(r.success).toBe(true)
      // Advanced to step 2 rather than waiting on a human.
      expect(r.instance.current_step_id).toBe(r.step2)
    })

    it('waits for a human when the condition fails', async () => {
      const r = await startWithContext({ field: 'amount', operator: '<', value: 1000 }, { amount: 5000 })
      expect(r.instance.current_step_id).toBe(r.step1)
    })

    it('waits when the context lacks the field entirely', async () => {
      const r = await startWithContext({ field: 'amount', operator: '<', value: 1000 }, {})
      expect(r.instance.current_step_id).toBe(r.step1)
    })

    it('waits when the condition is malformed', async () => {
      const r = await startWithContext({ operator: '<', value: 1000 }, { amount: 1 })
      expect(r.instance.current_step_id).toBe(r.step1)
    })

    it('waits on an unrecognised operator rather than defaulting to approve', async () => {
      const r = await startWithContext({ field: 'amount', operator: '~=', value: 1000 }, { amount: 1 })
      expect(r.instance.current_step_id).toBe(r.step1)
    })

    it.each([
      ['<=', 1000, 1000, true],
      ['>', 1000, 1500, true],
      ['>=', 1000, 1000, true],
      ['==', 1000, 1000, true],
      ['!=', 1000, 999, true],
      ['>', 1000, 500, false],
    ])('evaluates %s correctly', async (operator, value, amount, shouldAdvance) => {
      const r = await startWithContext({ field: 'amount', operator, value }, { amount })
      const advanced = r.instance.current_step_id === r.step2
      expect(advanced).toBe(shouldAdvance)
    })
  })

  describe('actOnWorkflow', () => {
    const start = async () => {
      const entityId = newEntityId()
      const r = await startWorkflow({
        schoolId, workflowName: 'Test Approval', entityType: ENTITY, entityId, initiatedBy: userId,
      })
      return { entityId, instanceId: r.instance.id }
    }

    it('advances to the next step on approval instead of completing early', async () => {
      const { entityId, instanceId } = await start()
      const r = await actOnWorkflow({ schoolId, instanceId, userId, status: 'approved' })
      expect(r.success).toBe(true)
      expect(r.completed).toBe(false)
      expect(r.instance.current_step_id).toBe(stepIds[1])
    })

    it('completes the instance once the final step approves', async () => {
      const { entityId, instanceId } = await start()
      await actOnWorkflow({ schoolId, instanceId, userId, status: 'approved' })
      const r = await actOnWorkflow({ schoolId, instanceId, userId, status: 'approved' })
      expect(r.completed).toBe(true)
      expect(r.instance.status).toBe('approved')
    })

    it('terminates the whole instance on rejection', async () => {
      const { entityId, instanceId } = await start()
      const r = await actOnWorkflow({ schoolId, instanceId, userId, status: 'rejected' })
      expect(r.completed).toBe(true)
      expect(r.instance.status).toBe('rejected')
    })

    it('refuses someone whose role is not the current step', async () => {
      const email = `__vitest_wf_outsider_${Date.now()}@example.com`
      const { data: au } = await sb.auth.admin.createUser({ email, password: 'Test@12345', email_confirm: true })
      await sb.from('users').insert({ id: au.user.id, school_id: schoolId, full_name: 'Outsider', email, role: 'teacher' })
      try {
        const { instanceId } = await start()
        const r = await actOnWorkflow({ schoolId, instanceId, userId: au.user.id, status: 'approved' })
        expect(r.success).toBe(false)
      } finally {
        await sb.from('users').delete().eq('id', au.user.id)
        await sb.auth.admin.deleteUser(au.user.id).catch(() => {})
      }
    })

    it('refuses to act on an entity with no workflow instance', async () => {
      const r = await actOnWorkflow({ schoolId, instanceId: crypto.randomUUID(), userId, status: 'approved' })
      expect(r.success).toBe(false)
    })

    it('records a comment without advancing the step', async () => {
      const { entityId, instanceId } = await start()
      const r = await actOnWorkflow({ schoolId, instanceId, userId, status: 'commented', notes: 'looking' })
      expect(r.success).toBe(true)
      expect(r.completed).toBe(false)
      expect(r.instance.current_step_id).toBe(stepIds[0])
    })
  })

  describe('getWorkflowStatus', () => {
    it('returns the instance with its recorded approvals', async () => {
      const entityId = newEntityId()
      const started = await startWorkflow({ schoolId, workflowName: 'Test Approval', entityType: ENTITY, entityId, initiatedBy: userId })
      await actOnWorkflow({ schoolId, instanceId: started.instance.id, userId, status: 'approved' })
      const status = await getWorkflowStatus(ENTITY, entityId, schoolId)
      expect(status).toBeTruthy()
      expect((status as any).approvals?.length ?? 0).toBeGreaterThan(0)
    })

    it('returns nothing for an entity that never started one', async () => {
      expect(await getWorkflowStatus(ENTITY, newEntityId(), schoolId)).toBeFalsy()
    })
  })
})
