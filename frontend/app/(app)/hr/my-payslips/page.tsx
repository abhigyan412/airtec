'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi, documentsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatCurrency } from '@/lib/utils'
import { CreditCard, Printer, IndianRupee } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const PAY_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info'> = {
  pending: 'warning', approved: 'info', paid: 'success', on_hold: 'destructive', failed: 'destructive',
}

export default function MyPayslipsPage() {
  const { user } = useAuth()

  // Always pass user_id explicitly rather than relying on the backend's
  // implicit self-scoping — that only kicks in for non-admins, so a
  // School Admin/Principal/Accountant checking their OWN payslips here
  // would otherwise silently see every staff member's, the same class
  // of bug already fixed on the Leave Requests page earlier.
  const { data: payslips, isLoading } = useQuery({
    queryKey: ['my-payslips', user?.id],
    queryFn: () => hrmsApi.payslips.list({ user_id: user?.id, limit: 24 }).then(r => r.data),
    enabled: !!user,
  })

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="My Payslips"
        description="View and print your salary payslips"
        icon={CreditCard}
      />

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-muted-foreground" /> Payslip History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (payslips ?? []).length === 0 ? (
            <EmptyState
              icon={IndianRupee}
              title="No payslips yet"
              description="Payslips appear here once a monthly payroll run including you has been generated."
            />
          ) : (
            <div className="divide-y divide-border">
              {(payslips ?? []).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{MONTHS[p.month - 1]} {p.year}</span>
                      <Badge variant={PAY_STATUS_VARIANT[p.payment_status] ?? 'secondary'} className="capitalize">{p.payment_status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Net Pay: <span className="font-semibold text-foreground">{formatCurrency(Number(p.net_salary))}</span>
                      {Number(p.lop_days) > 0 && <span className="ml-2 text-xs text-warning">{p.lop_days} LOP day(s)</span>}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a href={documentsApi.payslip(p.id)} target="_blank" rel="noreferrer">
                      <Printer className="h-3.5 w-3.5" /> View / Print
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
