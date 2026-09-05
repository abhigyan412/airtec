'use client'
import { useAuth } from '@/lib/auth'
import { Settings as SettingsIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { WorkflowSettingsCard } from '@/components/shared/WorkflowSettingsCard'

// First settings surface for HRMS — until now, all four of its approval
// chains (Leave, Exit, Regularization, Comp-Off) were stuck at whatever
// single step ensureSingleStepWorkflow-based seeding created (HR, falling
// back to Principal), with no way for a school to change who approves it
// or add more steps. Same GET/PUT-a-step-list pattern the exam module's
// Result Settings and Admission/Student Settings' own workflow cards
// already use — all built on the same shared engine.
export default function HrSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin'

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="HR Settings"
        description="Configure the approval chain for each of HR's own workflows."
        icon={SettingsIcon}
        className="mb-0"
      />

      {!canManage && (
        <p className="text-sm text-muted-foreground">Only School Admin can change these — shown here read-only.</p>
      )}

      <WorkflowSettingsCard
        title="Leave Approval Workflow"
        description="Choose how many approval steps a leave request goes through before it's granted, and which of your school's roles each step belongs to."
        queryKey="hr-workflow-leave"
        apiPath="/hrms/settings/workflow/leave"
        canManage={canManage}
      />
      <WorkflowSettingsCard
        title="Staff Exit Settlement Workflow"
        description="Choose how many approval steps a staff exit's final settlement goes through."
        queryKey="hr-workflow-exit"
        apiPath="/hrms/settings/workflow/exit"
        canManage={canManage}
      />
      <WorkflowSettingsCard
        title="Attendance Regularization Workflow"
        description="Choose how many approval steps a staff attendance regularization request goes through."
        queryKey="hr-workflow-regularization"
        apiPath="/hrms/settings/workflow/regularization"
        canManage={canManage}
      />
      <WorkflowSettingsCard
        title="Comp-Off Approval Workflow"
        description="Choose how many approval steps a comp-off request goes through."
        queryKey="hr-workflow-comp-off"
        apiPath="/hrms/settings/workflow/comp-off"
        canManage={canManage}
      />
    </div>
  )
}
