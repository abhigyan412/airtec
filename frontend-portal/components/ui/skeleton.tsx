import { cn } from '@/lib/utils'

/**
 * Placeholder block. Compose these into the *shape of the real content* rather
 * than dropping one grey box on the page — a skeleton that matches the final
 * layout means nothing jumps when the data lands.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden {...props} />
}

export { Skeleton }
