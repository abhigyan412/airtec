'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, PieChart, X, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { studentsApi } from '@/lib/api'
import { StudentPerformanceChart } from '@/components/students/StudentPerformanceChart'

type PickedStudent = { id: string; name: string; context: string }

// Right on the dashboard, not buried behind Students > class > section —
// search any student by name and the pie chart opens in place. The
// class/section browse path on the Students page still works too; this
// is the fast path for "I already know who I'm looking for."
export function StudentPerformanceLookup() {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<PickedStudent | null>(null)
  const [examId, setExamId] = useState<string | undefined>(undefined)

  const { data, isLoading } = useQuery({
    queryKey: ['principal-student-search', query],
    queryFn: () => studentsApi.list({ search: query, limit: 8 }).then(r => r.data),
    enabled: query.trim().length >= 2,
  })
  const results = data ?? []

  const selectStudent = (s: any) => {
    setPicked({
      id: s.id,
      name: `${s.first_name} ${s.last_name}`,
      context: [s.classes?.name, s.sections?.name].filter(Boolean).join(' · '),
    })
    setExamId(undefined)
    setQuery('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-muted-foreground" /> Student Performance Lookup
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">Search any student to see their marks by subject across every exam</p>
      </CardHeader>
      <CardContent>
        {picked ? (
          <div className="space-y-4">
            <button
              onClick={() => setPicked(null)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Search another student
            </button>
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
                  {picked.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-semibold text-foreground">{picked.name}</p>
                {picked.context && <p className="text-xs text-muted-foreground">{picked.context}</p>}
              </div>
            </div>
            <StudentPerformanceChart studentId={picked.id} examId={examId} onExamChange={setExamId} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by student name..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="pl-10 pr-9"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {query.trim().length < 2 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Type at least 2 characters to search</p>
            ) : isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
            ) : results.length === 0 ? (
              <EmptyState icon={Search} title="No students match that search" className="py-8" />
            ) : (
              <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
                {results.map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => selectStudent(s)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                        {s.first_name?.[0]}{s.last_name?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{s.first_name} {s.last_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[s.classes?.name, s.sections?.name].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
