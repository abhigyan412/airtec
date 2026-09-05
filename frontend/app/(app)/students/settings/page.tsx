'use client'
import { useAuth } from '@/lib/auth'
import { Settings as SettingsIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { WorkflowSettingsCard } from '@/components/shared/WorkflowSettingsCard'

// First settings surface for the students/SIS module — until now, the
// Transfer Certificate approval chain was stuck at whatever
// ensureTransferCertificateWorkflowDefinition seeded (Accountant ->
// Principal), with no way for a school to change it. Same
// GET/PUT-a-step-list pattern the exam module's Result Settings ->
// Publish Workflow tab and Admission Settings' own workflow cards already
// use — all built on the same shared engine.
export default function StudentsSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin'

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Student Settings"
        description="Configuration for student records that isn't specific to any one student."
        icon={SettingsIcon}
        className="mb-0"
      />

      {!canManage && (
        <p className="text-sm text-muted-foreground">Only School Admin can change these — shown here read-only.</p>
      )}

      <WorkflowSettingsCard
        title="Transfer Certificate Workflow"
        description="Choose how many approval steps a Transfer Certificate request goes through before it's issued, and which of your school's roles each step belongs to."
        queryKey="tc-workflow-settings"
        apiPath="/students/settings/workflow/transfer-certificate"
        canManage={canManage}
      />
    </div>
  )
}
