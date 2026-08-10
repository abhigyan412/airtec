'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { FileText, Eye, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

// Same labels/expiry-threshold logic as the admin staff-profile
// Documents tab (frontend/app/(app)/hr/staff/[id]/page.tsx) — kept in
// sync by hand rather than a shared import since this view is
// deliberately read-mostly (no upload/delete, only acknowledge), a
// genuinely different shape from the admin tab, not a drifted copy of it.
const DOC_TYPE_LABELS: Record<string, string> = {
  contract: 'Contract', id_proof: 'ID Proof', certification: 'Certification',
  police_verification: 'Police Verification', offer_letter: 'Offer Letter', policy: 'Policy', other: 'Other',
}

export default function MyDocumentsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: docs, isLoading } = useQuery({
    queryKey: ['my-documents', user?.id],
    queryFn: () => hrmsApi.staff.documents.list(user!.id).then(r => r.data),
    enabled: !!user,
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (docId: string) => hrmsApi.staff.documents.acknowledge(user!.id, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-documents', user?.id] })
      toast.success('Acknowledged')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to acknowledge'),
  })

  const expiryBadge = (expiryDate: string | null) => {
    if (!expiryDate) return null
    const cls = expiryDate < today
      ? 'bg-destructive/10 text-destructive ring-destructive/20'
      : expiryDate <= thirtyDaysOut
        ? 'bg-warning/10 text-warning ring-warning/20'
        : 'bg-muted text-muted-foreground ring-border'
    return (
      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', cls)}>
        {expiryDate < today ? 'Expired ' : 'Expires '}{formatDate(expiryDate)}
      </span>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Documents"
        description="Your contracts, IDs, certifications, and other records on file"
        icon={FileText}
      />

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Document Repository</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (docs ?? []).length === 0 ? (
            <EmptyState icon={FileText} title="No documents on file yet"
              description="Contracts, ID proofs, certifications and more will appear here once HR uploads them." />
          ) : (
            <div className="divide-y divide-border">
              {(docs ?? []).map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{doc.document_name}</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}</span>
                      {expiryBadge(doc.expiry_date)}
                      {doc.requires_acknowledgment && (
                        doc.acknowledged_at
                          ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Acknowledged {formatDate(doc.acknowledged_at)}</span>
                          : <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Awaiting acknowledgment</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {doc.file_size} · uploaded {formatDate(doc.created_at)}{doc.uploaded_by_user?.full_name ? ` by ${doc.uploaded_by_user.full_name}` : ''}
                    </p>
                    {doc.notes && <p className="mt-1 text-xs text-muted-foreground">{doc.notes}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {doc.requires_acknowledgment && !doc.acknowledged_at && (
                      <Button size="sm" variant="outline" onClick={() => acknowledgeMutation.mutate(doc.id)} disabled={acknowledgeMutation.isPending}>
                        <Check className="h-3.5 w-3.5" /> I've read this
                      </Button>
                    )}
                    <Button asChild variant="ghost" size="icon" title="View">
                      <a href={doc.file_url} target="_blank" rel="noreferrer"><Eye className="h-4 w-4" /></a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
