'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCheck, Tag, Clock, Undo2, Ban, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, invalidateFeeQueries } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

// One queue for everything waiting on a decision.
//
// Concessions live in fee_discounts with their own workflow; waivers,
// cancellations and refunds live in fee_action_requests. An approver does not
// care about that distinction — they care that four things need a yes or a no.
// Splitting them across two screens is how a request sits for a week.

const KIND: Record<string, { label: string; icon: any; tone: string; blurb: string }> = {
  discount: {
    label: 'Concession', icon: Tag, tone: 'bg-primary/10 text-primary',
    blurb: 'Reduces what the family is billed, on this and future invoices.',
  },
  late_fee_waiver: {
    label: 'Late fee waiver', icon: Clock, tone: 'bg-warning/10 text-warning',
    blurb: 'Removes the accrued late fee from the invoice.',
  },
  payment_cancel: {
    label: 'Cancel a payment', icon: Ban, tone: 'bg-destructive/10 text-destructive',
    blurb: 'Voids the receipt. The balance goes back up by the same amount.',
  },
  refund: {
    label: 'Refund', icon: Undo2, tone: 'bg-destructive/10 text-destructive',
    blurb: 'Returns money already collected. The balance goes back up.',
  },
}

export default function ApprovalsPage() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const [target, setTarget] = useState<{ item: any; decision: 'approved' | 'rejected' } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, isPending } = useQuery({
    queryKey: ['fee-approvals'],
    queryFn: () => feeApi.approvals(),
  })

  const items: any[] = data?.data ?? []
  const canDecideRequests = can('fee.structure_manage')
  const canDecideDiscounts = can('fee.discount')

  const decide = async () => {
    if (!target) return
    setBusy(true)
    try {
      // "Approved and applied" was true of a waiver and false of a concession: a
      // concession reduces the NEXT invoice raised and leaves anything already
      // issued at the full amount. The server says how much that is.
      let billed: any = null
      if (target.item.source === 'discount') {
        const res: any = await feeApi.discounts.decide(target.item.id, target.decision, note || undefined)
        billed = res?.already_billed
      } else {
        await feeApi.requests.decide(target.item.id, target.decision, note || undefined)
      }

      if (target.decision !== 'approved') {
        toast.success('Rejected')
      } else if (billed?.count) {
        toast.warning(`Approved — but ${billed.count} invoice${billed.count === 1 ? '' : 's'} already raised`, {
          description: `${formatCurrency(billed.outstanding)} is still billed at the full amount. `
            + 'The concession applies from the next invoice raised.',
          duration: 10000,
        })
      } else {
        toast.success(target.item.source === 'discount'
          ? 'Approved — it reduces the next invoice raised'
          : 'Approved and applied')
      }
      invalidateFeeQueries(qc)
      setTarget(null)
      setNote('')
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not record the decision')
    } finally {
      setBusy(false)
    }
  }

  const canDecide = (item: any) =>
    item.source === 'discount' ? canDecideDiscounts : canDecideRequests

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Everything waiting on a decision, across concessions, waivers, cancellations and refunds"
        icon={UserCheck}
      />

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting"
            description="Every concession, waiver, cancellation and refund has been decided."
            className="py-14"
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data?.meta?.by_kind ?? {}).map(([kind, count]) => {
              const k = KIND[kind] ?? { label: kind, tone: 'bg-muted text-muted-foreground' }
              return (
                <span key={kind} className={cn('rounded-full px-3 py-1 text-xs font-semibold', k.tone)}>
                  {count as number} {k.label.toLowerCase()}
                </span>
              )
            })}
          </div>

          <div className="space-y-3">
            {items.map(item => {
              const k = KIND[item.kind] ?? KIND.discount
              const Icon = k.icon
              const allowed = canDecide(item)
              return (
                <Card key={`${item.source}-${item.id}`}>
                  <CardContent className="flex flex-wrap items-start gap-4 p-5">
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', k.tone)}>
                      <Icon className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className="font-semibold text-foreground">{item.label}</p>
                        <p className="text-lg font-bold tabular-nums text-foreground">
                          {item.display_amount ?? (item.amount != null ? formatCurrency(item.amount) : '')}
                        </p>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {item.student ? (
                          <Link
                            href={`/fees/collect/student/${item.student.id ?? ''}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {item.student.first_name} {item.student.last_name}
                          </Link>
                        ) : 'Unknown student'}
                        {item.student?.classes?.name && ` · ${item.student.classes.name}`}
                        {item.requested_by && ` · requested by ${item.requested_by}`}
                        {` · ${formatDate(item.created_at)}`}
                      </p>
                      <p className="mt-1.5 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
                        {item.reason}
                      </p>
                      {/* What saying yes actually does — an approver should not
                          have to remember which of four things this kind is. */}
                      <p className="mt-1.5 text-xs text-muted-foreground">{k.blurb}</p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      {allowed ? (
                        <>
                          <Button
                            size="sm" variant="outline"
                            onClick={() => { setTarget({ item, decision: 'rejected' }); setNote('') }}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm" className="bg-success text-success-foreground hover:bg-success/90"
                            onClick={() => { setTarget({ item, decision: 'approved' }); setNote('') }}
                          >
                            Approve
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">View only</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {target && (
        <ConfirmDialog
          open
          onOpenChange={o => { if (!o) setTarget(null) }}
          title={target.decision === 'approved' ? `Approve this ${KIND[target.item.kind]?.label.toLowerCase()}?` : 'Reject this request?'}
          description={
            target.decision === 'approved'
              ? KIND[target.item.kind]?.blurb
              : 'Nothing changes on the account. The requester can raise it again.'
          }
          destructive={target.decision === 'rejected'}
          confirmLabel={target.decision === 'approved' ? 'Approve' : 'Reject'}
          loading={busy}
          onConfirm={decide}
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="decision-note">Note {target.decision === 'rejected' ? '*' : '(optional)'}</Label>
              <Textarea
                id="decision-note" rows={2} className="resize-none"
                value={note} onChange={e => setNote(e.target.value)}
                placeholder={target.decision === 'approved'
                  ? 'Anything the record should show about this decision'
                  : 'Why is this being turned down?'}
              />
            </div>
            {target.decision === 'approved' && target.item.source === 'request' && (
              <Alert variant="warning" title="This moves money immediately">
                Approving applies the action now — the family&apos;s balance changes
                as soon as you confirm.
              </Alert>
            )}
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}
