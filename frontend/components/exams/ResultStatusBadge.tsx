import { Badge, type BadgeProps } from '@/components/ui/badge'

// result_status (pass/fail/compartment/not_eligible/withheld) is populated
// by every generate-results run since the Result Settings engine shipped
// — falls back to the plain is_pass boolean for any report card generated
// before that, or if it's somehow still null. Shared across every place a
// report card's result renders: an exam's own Results tab, the standalone
// /exams/results lookup, and a composite Term's results.
const RESULT_STATUS_BADGE: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  pass: { label: 'Pass', variant: 'success' },
  fail: { label: 'Fail', variant: 'destructive' },
  compartment: { label: 'Compartment', variant: 'warning' },
  not_eligible: { label: 'Not Eligible', variant: 'secondary' },
  withheld: { label: 'Withheld', variant: 'secondary' },
}

export function ResultStatusBadge({ status, isPass }: { status?: string | null; isPass: boolean }) {
  const c = RESULT_STATUS_BADGE[status ?? ''] ?? RESULT_STATUS_BADGE[isPass ? 'pass' : 'fail']
  return <Badge variant={c.variant}>{c.label}</Badge>
}
