import { AlertCircle } from 'lucide-react'

// The portal's version of "I could not find out".
//
// Self-contained rather than imported from the staff app: the two frontends are
// deliberately separate builds (see the header comment in lib/api.ts), and the
// portal has no Alert component of its own.
//
// The failure this exists for is the worst one in the product. The fees page
// reads `summary?.totalDue ?? 0`, which on a failed request is 0, which sets
// `settled = true`, which renders a full-width green panel telling a family who
// owes ₹40,000 that they are all paid up. They then do not pay, and the school
// chases them for something the app told them they did not owe.

export function queryErrorMessage(error: unknown): string {
  return (error as any)?.response?.data?.error
    ?? (error as Error)?.message
    ?? 'The request failed.'
}

export function QueryError({
  error,
  title = 'Could not load this',
}: {
  error: unknown
  title?: string
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 opacity-90">
          {queryErrorMessage(error)} Please pull to refresh, or check with the
          school office — do not assume there is nothing to pay.
        </p>
      </div>
    </div>
  )
}
