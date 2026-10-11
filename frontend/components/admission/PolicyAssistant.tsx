'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { StatCard } from '@/components/shared/StatCard'

// Moved out of the Admission Settings page onto its own sidebar section
// (/admission/assistant) — this is the module's AI/backtest surface, not a
// configuration screen, and it earned its own place in the nav once it grew
// past "one card among the settings."

// Policy copilot v1 (see admission/plan.md's follow-on discussion): a
// read-only backtest, not a chat interface — given a hypothetical fee-hold
// window, shows which real applications would have ended up differently.
// Deliberately zero LLM involvement — this is the deterministic engine the
// Admission Policy Assistant above calls as a tool. Demoted to a secondary,
// manual-verification option (collapsed by default) now that the Assistant
// exists as the primary interface — kept, not removed, since it's the only
// way to check a number without going through the AI at all. Restricted to
// School Admin/Principal — same audience as Extend Fee Hold and the manual
// expire-fee-holds trigger this mirrors — and not shown to anyone else at
// all, since there is no read-only view for this tool the way the other
// cards on the Settings page have one.
export function FeeHoldPolicySimulatorCard() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const classStyle = useClassDisplayStyle()
  const [expanded, setExpanded] = useState(false)
  const [holdDays, setHoldDays] = useState('')
  const [graceDays, setGraceDays] = useState('')
  const [classId, setClassId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const { data: classes } = useQuery({
    queryKey: ['admission-classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
    enabled: expanded,
  })
  const classLabelById = new Map<string, string>((classes ?? []).map((c: any) => [c.id, classLabel(c.name, c.numeric_level, classStyle)]))

  const simulateMutation = useMutation({
    mutationFn: () => admissionApi.applications.simulateFeeHoldPolicy({
      hypothetical_hold_days: Number(holdDays),
      hypothetical_grace_days: graceDays.trim() === '' ? undefined : Number(graceDays),
      class_id: classId || undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
    }),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Simulation failed'),
  })

  const result = simulateMutation.data?.data

  const handleSimulate = () => {
    const n = Number(holdDays)
    if (!Number.isInteger(n) || n < 0) {
      toast.error('Hypothetical hold days must be a non-negative whole number')
      return
    }
    simulateMutation.mutate()
  }

  if (!canManage) return null

  return (
    <Card>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <CardTitle className="text-sm">Fee-Hold Policy Simulator (manual)</CardTitle>
          <CardDescription className="text-xs mt-0.5">Prefer to check the numbers yourself instead of asking the assistant above? Set the values directly and see what would have happened to real applications under a different fee-hold window.</CardDescription>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Hypothetical hold days</Label>
              <Input type="number" min={0} value={holdDays} onChange={e => setHoldDays(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hypothetical grace days</Label>
              <Input type="number" min={0} placeholder="Current setting" value={graceDays} onChange={e => setGraceDays(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Class (optional)</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
                <SelectContent>
                  {(classes ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{classLabel(c.name, c.numeric_level, classStyle)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From (optional)</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To (optional)</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
          </div>

          <Button onClick={handleSimulate} disabled={simulateMutation.isPending}>
            {simulateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Simulate
          </Button>

          {result && (
            <div className="space-y-4 pt-2 border-t border-border">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                <StatCard label="Would be saved" value={result.summary.saved_count} accent="success" hint="rejections avoided" />
                <StatCard label="Would be newly rejected" value={result.summary.newly_rejected_count} accent="destructive" hint="new losses" />
                <StatCard label="Still open either way" value={result.summary.still_pending_count} accent="info" />
                <StatCard
                  label="Revenue impact"
                  value={`${result.summary.revenue_delta_total >= 0 ? '+' : ''}₹${Number(result.summary.revenue_delta_total).toLocaleString('en-IN')}`}
                  accent={result.summary.revenue_delta_total >= 0 ? 'success' : 'destructive'}
                  hint={`₹${Number(result.summary.revenue_delta_known).toLocaleString('en-IN')} known, ₹${Number(result.summary.revenue_delta_estimated).toLocaleString('en-IN')} estimated`}
                />
              </div>

              {(result.summary.applications_missing_fee_amount > 0 || result.summary.skipped_count > 0) && (
                <p className="text-xs text-muted-foreground">
                  {result.summary.applications_missing_fee_amount > 0 && `${result.summary.applications_missing_fee_amount} affected application(s) excluded from the revenue estimate — no admission fee configured for their class. `}
                  {result.summary.skipped_count > 0 && `${result.summary.skipped_count} application(s) excluded entirely — no completed approval record found.`}
                </p>
              )}

              {result.applications.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3 font-medium">Applicant</th>
                        <th className="py-2 pr-3 font-medium">Class</th>
                        <th className="py-2 pr-3 font-medium">Real outcome</th>
                        <th className="py-2 pr-3 font-medium">Hypothetical outcome</th>
                        <th className="py-2 pr-3 font-medium">Revenue impact</th>
                        <th className="py-2 pr-3 font-medium">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.applications.map((a: any) => (
                        <tr key={a.application_id} className="border-b border-border/50">
                          <td className="py-2 pr-3">{a.student_name}{a.application_number ? ` (${a.application_number})` : ''}</td>
                          <td className="py-2 pr-3">{classLabelById.get(a.class_id) ?? '—'}</td>
                          <td className="py-2 pr-3"><Badge variant={a.effect === 'saved' ? 'default' : 'destructive'}>{a.real_outcome}</Badge></td>
                          <td className="py-2 pr-3 text-muted-foreground">{a.hypothetical_outcome}</td>
                          <td className="py-2 pr-3">
                            {a.revenue_impact != null
                              ? `${a.revenue_impact >= 0 ? '+' : ''}₹${Number(a.revenue_impact).toLocaleString('en-IN')}${a.revenue_impact_is_estimate ? ' (est.)' : ''}`
                              : '—'}
                          </td>
                          <td className="py-2 pr-3">
                            {a.had_manual_extension && <Badge variant="outline" className="text-xs">manually extended</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No affected applications for these parameters — {result.summary.total_considered} application(s) considered, none would change outcome.</p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// Admission Policy Assistant — the single, primary interface for every
// registered "what if" simulator in the admission module (see
// backend/src/modules/admission/policySimulators.ts). It's the front door:
// adding a setting to the registry makes it askable here automatically, via
// the capability list /policy-copilot/status now returns, with no new card
// needed. The model's only job is to call one or more of those registered
// tools and narrate their real output; it never invents a number. Same
// School Admin/Principal audience, and hidden entirely (not just disabled)
// when the deployment has no ANTHROPIC_API_KEY configured — a supported
// configuration, not a broken page, matching this app's OneSignal-push
// convention. The structured Fee-Hold Policy Simulator card below is kept
// as a manual fallback, not replaced — this panel doesn't remove any way to
// check a number without the AI.
export function PolicyCopilotAskCard() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const [expanded, setExpanded] = useState(false)
  const [question, setQuestion] = useState('')

  const { data: status } = useQuery({
    queryKey: ['policy-copilot-status'],
    queryFn: () => admissionApi.applications.policyCopilot.status().then(r => r.data),
    enabled: expanded && canManage,
  })

  const askMutation = useMutation({
    mutationFn: () => admissionApi.applications.policyCopilot.ask(question),
    onError: (e: any) => toast.error(
      e?.response?.status === 503
        ? 'The admission policy assistant is not configured for this deployment.'
        : (e?.response?.data?.error ?? 'Ask failed'),
    ),
  })

  const result = askMutation.data?.data

  if (!canManage) return null

  return (
    <Card>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <CardTitle className="text-sm">Admission Policy Assistant</CardTitle>
          <CardDescription className="text-xs mt-0.5">Ask a plain-English "what if" question about admission policy settings — it can only answer by running a real backtest against your data, and will say so if a question is out of scope.</CardDescription>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {status && status.available === false ? (
            <p className="text-sm text-muted-foreground">Not configured for this deployment.</p>
          ) : (
            <>
              {!!status?.capabilities?.length && (
                <div className="flex flex-wrap gap-2">
                  {status.capabilities.map((c: any) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setQuestion(c.example_prompt)}
                      className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-muted transition-colors"
                    >
                      {c.example_prompt}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Textarea
                  placeholder='e.g. "What if I extended the fee hold to 10 days?"'
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  maxLength={500}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={() => askMutation.mutate()} disabled={!question.trim() || askMutation.isPending}>
                  {askMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Ask
                </Button>
                {askMutation.isPending && <span className="text-xs text-muted-foreground">This can take up to a minute for more involved questions…</span>}
              </div>

              {result && (
                <div className="space-y-4 pt-2 border-t border-border">
                  <p className="text-sm text-foreground pt-4 whitespace-pre-wrap">{result.answer}</p>

                  {(result.simulations ?? []).map((entry: any, i: number) => (
                    <div key={i} className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">{simulationCaption(entry)}</p>
                      <SimulationResultBlock entry={entry} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// One entry in result.simulations — the copilot can now call a tool more
// than once (e.g. trying several hypothetical values before recommending
// one), so each call gets its own labeled block instead of a single
// unlabeled result the way it worked when exactly one call was possible.
function simulationCaption(entry: { tool_used: string; simulation: any }): string {
  const s = entry.simulation
  switch (entry.tool_used) {
    case 'simulate_fee_hold_policy':
      return `Fee hold: ${s.params.hypothetical_hold_days} day(s)${s.params.hypothetical_grace_days ? `, +${s.params.hypothetical_grace_days}d grace` : ''}`
    case 'simulate_stage_aging_alert':
      return `Stage aging: ${s.hypothetical_aging_days} day(s)`
    case 'simulate_occupancy_alert':
      return `Occupancy: ${s.hypothetical_percent}% within ${s.hypothetical_days} day(s)`
    case 'get_stuck_inquiry_details':
      return `Stuck inquiries: ${s.hypothetical_aging_days}-day threshold`
    default:
      return entry.tool_used
  }
}

function SimulationResultBlock({ entry }: { entry: { tool_used: string; simulation: any } }) {
  const s = entry.simulation

  if (entry.tool_used === 'simulate_fee_hold_policy') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Would be saved" value={s.summary.saved_count} accent="success" hint="rejections avoided" />
        <StatCard label="Would be newly rejected" value={s.summary.newly_rejected_count} accent="destructive" hint="new losses" />
        <StatCard label="Still open either way" value={s.summary.still_pending_count} accent="info" />
        <StatCard
          label="Revenue impact"
          value={`${s.summary.revenue_delta_total >= 0 ? '+' : ''}₹${Number(s.summary.revenue_delta_total).toLocaleString('en-IN')}`}
          accent={s.summary.revenue_delta_total >= 0 ? 'success' : 'destructive'}
          hint={`₹${Number(s.summary.revenue_delta_known).toLocaleString('en-IN')} known, ₹${Number(s.summary.revenue_delta_estimated).toLocaleString('en-IN')} estimated`}
        />
      </div>
    )
  }

  if (entry.tool_used === 'simulate_stage_aging_alert') {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Would be flagged" value={s.total_flagged} accent="warning" hint={`vs. ${s.actual_aging_days}-day current threshold`} />
        </div>
        {s.by_status.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {s.by_status.map((st: any) => <Badge key={st.status} variant="secondary">{st.status}: {st.count}</Badge>)}
          </div>
        )}
      </div>
    )
  }

  if (entry.tool_used === 'simulate_occupancy_alert') {
    return s.classes_flagged.length > 0 ? (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-3 font-medium">Class</th>
              <th className="py-2 pr-3 font-medium">Occupancy</th>
              <th className="py-2 pr-3 font-medium">Confirmed / Capacity</th>
            </tr>
          </thead>
          <tbody>
            {s.classes_flagged.map((c: any) => (
              <tr key={c.class_id} className="border-b border-border/50">
                <td className="py-2 pr-3">{c.class_name}</td>
                <td className="py-2 pr-3">{c.occupancy_percent}%</td>
                <td className="py-2 pr-3 text-muted-foreground">{c.confirmed} / {c.capacity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">{s.within_window ? 'No classes would be flagged.' : 'No admission cycle closing within that window.'}</p>
    )
  }

  if (entry.tool_used === 'get_stuck_inquiry_details') {
    return (
      <div className="space-y-2">
        {s.total_matching > s.inquiries.length && (
          <p className="text-xs text-muted-foreground">Showing the {s.inquiries.length} oldest of {s.total_matching} matching inquiries.</p>
        )}
        <div className="divide-y divide-border">
          {s.inquiries.map((inq: any) => {
            const latest = inq.follow_ups[0]
            return (
              <div key={inq.inquiry_id} className="py-2 flex items-start justify-between gap-3">
                <div>
                  <span className="text-sm font-medium text-foreground">{inq.student_name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{inq.status}</span>
                </div>
                <p className="text-xs text-muted-foreground text-right max-w-xs">
                  {latest ? (latest.notes || latest.outcome || `${latest.channel ?? 'contact'} logged, no notes`) : 'No follow-up notes recorded'}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return null
}
