'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { homeworkApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Settings2, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// plan.md Phase 6/9's settings, moved off the Assign page onto its own
// route once there was a real tab bar to put it on — previously the only
// way to find these toggles was scrolling to the top of the Assign page
// and being School Admin, which is exactly the "hidden under UI" problem
// this whole restructure (mirroring Admission/Fees' Settings tab) exists
// to fix.
export default function HomeworkSettingsPage() {
  const { user } = useAuth()
  const isSchoolAdmin = user?.role === 'school_admin'

  const { data, isLoading } = useQuery({
    queryKey: ['homework-settings'],
    queryFn: () => homeworkApi.settings.get().then(r => r.data),
  })

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="Homework Settings" description="School-wide rules for submissions and grading" icon={Settings2} />

      {!isSchoolAdmin ? (
        <Card>
          <EmptyState icon={ShieldOff} title="School Admin only" description="Ask your School Admin to change these settings." className="py-12" />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <HomeworkSettingsForm data={data} />
      )}
    </div>
  )
}

function HomeworkSettingsForm({ data }: { data: any }) {
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: (patch: { homework_accept_late_submissions?: boolean; homework_late_grace_days?: number; homework_resubmission_allowed?: boolean }) =>
      homeworkApi.settings.update(patch),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['homework-settings'] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Late submissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={!!data?.homework_accept_late_submissions} disabled={mutation.isPending}
              onChange={e => mutation.mutate({ homework_accept_late_submissions: e.target.checked })} />
            Accept submissions after the due date
          </label>
          <div className="flex items-center gap-2 text-sm text-foreground">
            Grace period
            <Input type="number" min={0} className="h-8 w-20" value={data?.homework_late_grace_days ?? 0}
              disabled={mutation.isPending || !data?.homework_accept_late_submissions}
              onChange={e => mutation.mutate({ homework_late_grace_days: Math.max(0, Number(e.target.value) || 0) })} />
            days
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Resubmission</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={!!data?.homework_resubmission_allowed} disabled={mutation.isPending}
              onChange={e => mutation.mutate({ homework_resubmission_allowed: e.target.checked })} />
            Allow resubmitting after grading (clears the previous grade and feedback)
          </label>
        </CardContent>
      </Card>
    </div>
  )
}
