'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { BarChart2, Plus, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

// Composite Term results — a school-wide Result Group list, scoped to one
// class at a time. Rather than re-implement the full weighted-results
// table twice, this browser only lists/creates terms and links out to
// each one's own detail page (member exams, weights, generate, publish,
// results) at /exams/result-groups/[id]. Rendered by the Results page's
// "Composite Term" toggle (/exams/results?mode=term) — the old dedicated
// /exams/terms route was removed since it was a pure duplicate.
export function TermResultsBrowser() {
  const router = useRouter()
  const qc = useQueryClient()
  const [classId, setClassId] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/admission/classes').then(r => r.data.data),
  })

  const { data: groups, isLoading } = useQuery({
    queryKey: ['result-groups', classId],
    queryFn: () => api.get('/exams/result-groups', { params: { class_id: classId } }).then(r => r.data.data as any[]),
    enabled: !!classId,
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/exams/result-groups', { name: newName, class_id: classId }),
    onSuccess: (r: any) => {
      toast.success('Term created')
      qc.invalidateQueries({ queryKey: ['result-groups', classId] })
      router.push(`/exams/result-groups/${r.data.data.id}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to create'),
  })

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end gap-4 p-5">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label>Class</Label>
          <Select value={classId || undefined} onValueChange={v => { setClassId(v); setShowNew(false) }}>
            <SelectTrigger><SelectValue placeholder="Select class..." /></SelectTrigger>
            <SelectContent>
              {(classes ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {classId && (
          showNew ? (
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label>Term Name</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Term 1" className="h-9 w-48" />
              </div>
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !newName.trim()}>
                {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> New Term</Button>
          )
        )}
      </Card>

      {!classId ? (
        <Card><EmptyState icon={BarChart2} title="Pick a class" description="Select a class above to see or create its composite Term results." /></Card>
      ) : isLoading ? (
        <Card className="space-y-3 p-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</Card>
      ) : !(groups ?? []).length ? (
        <Card><EmptyState icon={BarChart2} title="No terms yet for this class" description="Create one above to blend several exams into one weighted result." /></Card>
      ) : (
        <Card className="divide-y divide-border">
          {(groups ?? []).map((g: any) => (
            <Link key={g.id} href={`/exams/result-groups/${g.id}`} className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-muted/50">
              <span className="font-medium text-foreground">{g.name}</span>
              <Badge variant={g.status === 'result_published' ? 'success' : g.status === 'result_declared' ? 'info' : 'secondary'} className="capitalize">
                {g.status.replace(/_/g, ' ')}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </div>
  )
}
