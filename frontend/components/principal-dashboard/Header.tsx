'use client'
import { Skeleton } from '@/components/ui/skeleton'
import { usePrincipalDashboard } from '@/lib/usePrincipalDashboard'
import { useAuth } from '@/lib/auth'

export function PrincipalDashboardHeader() {
  const { user } = useAuth()
  const { data, isLoading } = usePrincipalDashboard()
  const firstName = (data?.header?.full_name ?? user?.full_name)?.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {greeting}, {firstName} 👋
        </h1>
        {isLoading ? (
          <Skeleton className="mt-1.5 h-4 w-48" />
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">School-wide academic oversight</p>
        )}
      </div>
      <div className="text-left sm:text-right">
        <p className="text-sm font-semibold text-foreground">{(user as any)?.schools?.name}</p>
        <p className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>
    </div>
  )
}
