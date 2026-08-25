'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'

// remaining-work-plan.md Section A4: these six school-level tuning knobs
// (fee-hold window, waitlist response window, dashboard alert thresholds)
// have existed since Phases 3/4/9 shipped with a safe default, but had no
// edit surface — this page is that surface. Everyone with admission.view
// can see the current values (they explain behavior they'll notice
// elsewhere, like why a seat freed up); only School Admin can change them.
const FIELDS: { key: string; label: string; help: string; suffix: string }[] = [
  { key: 'admission_fee_hold_days', label: 'Fee hold duration', help: 'Days an approved applicant has to pay before the seat auto-releases.', suffix: 'days' },
  { key: 'admission_fee_hold_grace_days', label: 'Fee hold grace period', help: 'Extra days after the deadline before the auto-release sweep actually acts.', suffix: 'days' },
  { key: 'admission_waitlist_response_days', label: 'Waitlist response window', help: 'Days a waitlisted candidate has to respond to an offered seat before it moves to the next rank.', suffix: 'days' },
  { key: 'admission_stage_aging_days', label: 'Stage aging alert threshold', help: 'Flag an inquiry on the dashboard once it has sat at the same stage this long.', suffix: 'days' },
  { key: 'admission_occupancy_warning_percent', label: 'Occupancy warning threshold', help: 'Flag a class on the dashboard if it is below this percent full as the cycle close date nears.', suffix: '%' },
  { key: 'admission_occupancy_warning_days', label: 'Occupancy warning lead time', help: 'How many days before cycle close the occupancy check above starts firing.', suffix: 'days' },
]

export default function AdmissionSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin'
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['admission-settings'],
    queryFn: () => admissionApi.settings.get().then(r => r.data),
  })

  useEffect(() => {
    if (!data) return
    setValues(Object.fromEntries(FIELDS.map(f => [f.key, String(data[f.key])])))
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, number>) => admissionApi.settings.update(payload),
    onSuccess: () => {
      toast.success('Settings saved')
      qc.invalidateQueries({ queryKey: ['admission-settings'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save settings'),
  })

  const dirty = data && FIELDS.some(f => values[f.key] !== undefined && values[f.key] !== String(data[f.key]))

  const handleSave = () => {
    const payload: Record<string, number> = {}
    for (const f of FIELDS) {
      const n = Number(values[f.key])
      if (!Number.isInteger(n) || n < 0) {
        toast.error(`${f.label} must be a non-negative whole number`)
        return
      }
      if (data[f.key] !== undefined && n !== data[f.key]) payload[f.key] = n
    }
    if (Object.keys(payload).length === 0) return
    saveMutation.mutate(payload)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Admission Settings"
        description="Timing and alert thresholds used across the pipeline — fee holds, waitlist offers, and dashboard alerts."
        icon={SettingsIcon}
        className="mb-0"
      />

      {!canManage && (
        <p className="text-sm text-muted-foreground">Only School Admin can change these — shown here read-only.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Timing & alert thresholds</CardTitle>
          <CardDescription className="text-xs">Each has shipped with a working default since its own feature launched — change only if the default doesn&apos;t fit this school.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            FIELDS.map(f => (
              <div key={f.key} className="grid grid-cols-[1fr_auto] items-start gap-3">
                <div className="space-y-1">
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <p className="text-xs text-muted-foreground">{f.help}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={f.key}
                    type="number"
                    min={0}
                    disabled={!canManage}
                    value={values[f.key] ?? ''}
                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    className="w-20 text-right"
                  />
                  <span className="text-xs text-muted-foreground w-8">{f.suffix}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!dirty || saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  )
}
