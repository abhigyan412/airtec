'use client'
import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { PolicyCopilotAskCard, FeeHoldPolicySimulatorCard } from '@/components/admission/PolicyAssistant'

export default function AdmissionAssistantPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Policy Assistant"
        description="Ask plain-English questions about admission policy settings, backed by real backtests against your data — plus a manual simulator below if you'd rather set the numbers yourself."
        icon={Sparkles}
        className="mb-0"
      />
      <PolicyCopilotAskCard />
      <FeeHoldPolicySimulatorCard />
    </div>
  )
}
