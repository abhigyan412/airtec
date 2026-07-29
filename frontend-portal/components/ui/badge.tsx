import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Every variant is token-driven, so a pill that reads "unpaid" carries the same
// red in both themes instead of the light-only `bg-rose-100` it used to. The
// inset ring gives the tint an edge without a second elevation layer.
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary ring-primary/20',
        neutral: 'bg-muted text-muted-foreground ring-border',
        success: 'bg-success/10 text-success ring-success/20',
        warning: 'bg-warning/10 text-warning ring-warning/25',
        destructive: 'bg-destructive/10 text-destructive ring-destructive/20',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
