'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { ADMISSION_ENTRANCE_MODES, admissionEntranceModeLabel } from '@/lib/admissionEntranceModes'
import { ADMISSION_DOC_TYPES } from '@/lib/admissionDocumentTypes'
import { Settings as SettingsIcon, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { CheckboxField } from '@/components/ui/checkbox'
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
        description="Everything that configures how the pipeline behaves per school and per class — timing thresholds, entrance assessment, admission fees, and the required-document checklist."
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

      <ConversionPrerequisitesCard />
      <EntranceModeCard />
      <DocumentRequirementsCard />
    </div>
  )
}

// remaining-work-plan.md follow-up (2026-08-26): user asked whether the
// flow was "gated well one by one" — investigated and found Convert to
// Application had almost no gate (just "not already converted"). Asked
// to make entrance-test completion and document submission hard
// prerequisites, but as a toggle schools decide for themselves, not a
// hardcoded rule — same "settings not hardcoded rules" principle every
// other admission setting follows, and both default off so existing
// schools see no behavior change until they opt in. Saves immediately on
// toggle, same convention as the class-display-style toggle elsewhere in
// this module, rather than requiring a separate Save press for a single
// on/off switch.
function ConversionPrerequisitesCard() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin'
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admission-settings'],
    queryFn: () => admissionApi.settings.get().then(r => r.data),
  })

  const toggleMutation = useMutation({
    mutationFn: (payload: Record<string, boolean>) => admissionApi.settings.update(payload),
    onSuccess: () => {
      toast.success('Updated')
      qc.invalidateQueries({ queryKey: ['admission-settings'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Conversion Requirements</CardTitle>
        <CardDescription className="text-xs">
          What must be true before an inquiry can convert to a formal application. Off by default — nothing is required unless turned on here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : (
          <>
            <CheckboxField
              label="Require the entrance test/interview to be completed"
              hint="At least one slot booking marked Attended, for this candidate, before their inquiry can convert."
              checked={!!data?.admission_require_entrance_test_before_conversion}
              disabled={!canManage || toggleMutation.isPending}
              onChange={e => toggleMutation.mutate({ admission_require_entrance_test_before_conversion: e.target.checked })}
            />
            <CheckboxField
              label="Require all checklist documents to be verified"
              hint="Uses the same per-class Document Requirements checklist below — documents can now be uploaded against an inquiry directly, before conversion."
              checked={!!data?.admission_require_documents_before_conversion}
              disabled={!canManage || toggleMutation.isPending}
              onChange={e => toggleMutation.mutate({ admission_require_documents_before_conversion: e.target.checked })}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

// Moved here from the Slots page 2026-08-26 — this is per-class
// configuration (how a class is assessed, and what it costs once
// admitted), not a scheduling concern, so it belongs with the rest of
// Admission Settings rather than sitting above the actual bookable-slots
// list. The Slots page's New/Edit Slot form still shows a class's
// configured mode as a read-only hint (via the same shared
// lib/admissionEntranceModes.ts this reads from), it just no longer owns
// the editor itself.
function EntranceModeCard() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const classStyle = useClassDisplayStyle()
  const [expanded, setExpanded] = useState(false)
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admission-class-settings'],
    queryFn: () => admissionApi.classSettings.list().then(r => r.data),
    enabled: expanded,
  })

  const updateMutation = useMutation({
    mutationFn: ({ classId, data }: { classId: string; data: { entrance_mode?: string; pass_marks_percent?: number; admission_fee_amount?: number | null } }) =>
      admissionApi.classSettings.update(classId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-class-settings'] })
      toast.success('Updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  return (
    <Card>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <CardTitle className="text-sm">Entrance Mode &amp; Admission Fee by Class</CardTitle>
          <CardDescription className="text-xs mt-0.5">How each class's entrance assessment is conducted, its pass mark, and the admission fee due once admitted.</CardDescription>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <CardContent className="pt-0">
          {isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : (
            <div className="divide-y divide-border">
              {(settings ?? []).map((s: any) => (
                <div key={s.class_id} className="flex items-center justify-between py-2.5 gap-3 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{classLabel(s.class_name, s.numeric_level, classStyle)}</span>
                  {canManage ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select value={s.entrance_mode} onValueChange={(v) => updateMutation.mutate({ classId: s.class_id, data: { entrance_mode: v } })}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ADMISSION_ENTRANCE_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {(s.entrance_mode === 'written_mcq' || s.entrance_mode === 'written_subjective' || s.entrance_mode === 'previous_academic_percentage') && (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number" min={0} max={100} defaultValue={s.pass_marks_percent}
                            className="w-16 h-9"
                            onBlur={(e) => {
                              const v = Number(e.target.value)
                              if (v !== s.pass_marks_percent) updateMutation.mutate({ classId: s.class_id, data: { pass_marks_percent: v } })
                            }}
                          />
                          <span className="text-xs text-muted-foreground">% required</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 border-l border-border pl-2">
                        <span className="text-xs text-muted-foreground">₹</span>
                        <Input
                          type="number" min={0} step="1" defaultValue={s.admission_fee_amount ?? ''}
                          placeholder="Not set" className="w-24 h-9"
                          onBlur={(e) => {
                            const raw = e.target.value.trim()
                            const v = raw === '' ? null : Number(raw)
                            if (v !== (s.admission_fee_amount ?? null)) updateMutation.mutate({ classId: s.class_id, data: { admission_fee_amount: v } })
                          }}
                        />
                        <span className="text-xs text-muted-foreground">admission fee</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">{admissionEntranceModeLabel(s.entrance_mode)}</Badge>
                      {(s.entrance_mode === 'written_mcq' || s.entrance_mode === 'written_subjective' || s.entrance_mode === 'previous_academic_percentage') && (
                        <span className="text-xs text-muted-foreground">{s.pass_marks_percent}% required</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {s.admission_fee_amount != null ? `₹${Number(s.admission_fee_amount).toLocaleString('en-IN')} admission fee` : 'Admission fee not set'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// Moved here from its own standalone /admission/document-requirements page
// 2026-08-26 — same reasoning as EntranceModeCard above: this is per-class
// configuration, not a distinct workflow surface, so it belongs alongside
// the rest of Admission Settings. Previously this page fully blocked
// anyone but School Admin from even viewing it (a hard "Access Denied");
// relaxed to match every other section on this page — everyone with
// admission.view can see the configured checklist, only School Admin can
// change it, same read-only-vs-editable split EntranceModeCard already used.
function DocumentRequirementsCard() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin'
  const classStyle = useClassDisplayStyle()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [classId, setClassId] = useState('')

  const { data: classes } = useQuery({
    queryKey: ['admission-classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
    enabled: expanded,
  })

  const { data: requirements, isLoading } = useQuery({
    queryKey: ['document-requirements', classId],
    queryFn: () => admissionApi.documentRequirements.list(classId).then(r => r.data),
    enabled: expanded && !!classId,
  })

  const requiredTypes = new Set((requirements ?? []).map((r: any) => r.document_type))

  const addMutation = useMutation({
    mutationFn: (document_type: string) => admissionApi.documentRequirements.create({ class_id: classId, document_type }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document-requirements', classId] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add'),
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => admissionApi.documentRequirements.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document-requirements', classId] }) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  const toggle = (docType: string) => {
    if (requiredTypes.has(docType)) {
      const row = (requirements ?? []).find((r: any) => r.document_type === docType)
      if (row) removeMutation.mutate(row.id)
    } else {
      addMutation.mutate(docType)
    }
  }

  return (
    <Card>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <CardTitle className="text-sm">Document Requirements by Class</CardTitle>
          <CardDescription className="text-xs mt-0.5">Mandatory documents per class. A class with nothing checked here never blocks admission on missing paperwork — this is opt-in, not a default requirement.</CardDescription>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <CardContent className="pt-0 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Choose a class</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select a class" /></SelectTrigger>
              <SelectContent>
                {(classes ?? []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{classLabel(c.name, c.numeric_level, classStyle)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">The checklist below applies at the final approval step for applications to this class.</p>
          </div>

          {classId && (
            isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {ADMISSION_DOC_TYPES.map(t => {
                  const active = requiredTypes.has(t.value)
                  const pending = addMutation.isPending || removeMutation.isPending
                  return (
                    <Button
                      key={t.value}
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      size="sm"
                      disabled={pending || !canManage}
                      onClick={() => toggle(t.value)}
                    >
                      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {t.label}
                    </Button>
                  )
                })}
              </div>
            )
          )}
        </CardContent>
      )}
    </Card>
  )
}
