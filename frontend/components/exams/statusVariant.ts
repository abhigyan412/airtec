import type { BadgeProps } from '@/components/ui/badge'

// Shared across every screen that shows an exam's status badge — was
// duplicated (and drifting: the Exams list's copy was missing the three
// result_frozen/result_verified/result_published keys the detail page's
// copy had) across exams/page.tsx, exams/datesheet/page.tsx, and
// exams/[id]/page.tsx before this extraction.
export const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  draft: 'secondary',
  published: 'info',
  ongoing: 'warning',
  completed: 'default',
  result_declared: 'success',
  result_frozen: 'info',
  result_verified: 'default',
  result_published: 'success',
}
