import { Alert } from '@/components/ui/alert'

// "I could not find out" is not "there is nothing".
//
// Every fee screen but one used to render a failed request as its empty state:
// the dashboard showed ₹0 billed and "Everything billed is collected", the
// defaulter list said "Nobody is behind", the aging report drew five ₹0 buckets,
// the parent portal told a family owing ₹40,000 they were all paid up, and the
// "a payment is in progress, do not take cash twice" card removed itself. React
// Query hands back `data === undefined` on failure and every one of those
// screens fell through to `?? 0` / `?? []`.
//
// The distinction matters most exactly where it was missing — a number nobody
// can act on is better than a number that is confidently wrong, because the
// second one gets acted on.
//
// Modelled on fees/structures/page.tsx, which was the only screen that got this
// right, so there is one shape to recognise across the app.

export function queryErrorMessage(error: unknown): string {
  return (error as any)?.response?.data?.error
    ?? (error as Error)?.message
    ?? 'The request failed.'
}

export function QueryError({
  error,
  title = 'Could not load this',
  className,
}: {
  error: unknown
  title?: string
  className?: string
}) {
  return (
    <Alert variant="destructive" title={title} className={className}>
      {queryErrorMessage(error)}{' '}
      Nothing has been changed. Reload to try again.
    </Alert>
  )
}
