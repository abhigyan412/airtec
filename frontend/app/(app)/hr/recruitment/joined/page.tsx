'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi, documentsApi } from '@/lib/api'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, FileText, Phone, Mail, UserCheck2, Users, Search } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { HrQuickNav } from '@/components/hr/HrQuickNav'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// A dedicated, filtered view of the "Joined" stage of the recruitment
// pipeline — the kanban board on /hr/recruitment mixes it in with six
// other stages, which makes "who joined for position X, and where's
// their offer letter" a multi-click hunt. This is that lookup, purpose
// built: filter by position, jump straight to the offer letter.
export default function JoinedCandidatesPage() {
  const [jobFilter, setJobFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data: jobsData } = useQuery({
    queryKey: ['job-postings'],
    queryFn: () => hrmsApi.jobPostings.list().then(r => r.data),
  })

  const { data: joined, isLoading } = useQuery({
    queryKey: ['applications', 'joined', jobFilter, search],
    queryFn: () => hrmsApi.applications.list({ status: 'joined', job_posting_id: jobFilter || undefined, search: search || undefined }).then(r => r.data),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/hr/recruitment" aria-label="Back to recruitment"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Joined Candidates"
          description="Everyone who's completed the pipeline and joined — filter by position to find their offer letter"
          icon={UserCheck2}
          actions={<HrQuickNav current="recruitment" />}
        />
      </div>

      {/* Search by candidate name/phone/email */}
      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="text" placeholder="Search by candidate name, phone, or email..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9" />
        </div>
      </Card>

      {/* Position filter pills — same source/pattern as the kanban board's,
          so a position filtered here means the same thing it does there. */}
      {jobsData && jobsData.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setJobFilter('')}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              !jobFilter ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>
            All Positions
          </button>
          {jobsData.map((j: any) => (
            <button key={j.id} onClick={() => setJobFilter(jobFilter === j.id ? '' : j.id)}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                jobFilter === j.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>
              {j.title}
            </button>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (joined ?? []).length === 0 ? (
          <EmptyState
            icon={Users}
            title={jobFilter || search ? 'No matching candidates' : 'No one has joined yet'}
            description={jobFilter || search ? 'Clear the search or position filter to see everyone who has joined.' : 'Candidates show up here once they move through the pipeline to Joined.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead className="hidden lg:table-cell">Experience</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined On</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(joined ?? []).map((c: any) => (
                  <TableRow key={c.id} className="hover:bg-muted/40">
                    <TableCell>
                      <p className="font-semibold text-foreground">{c.candidate_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{c.application_number}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium text-primary">{c.job_postings?.title ?? '—'}</p>
                      {c.job_postings?.department && <p className="text-xs text-muted-foreground">{c.job_postings.department}</p>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {c.phone}</div>
                        {c.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {c.email}</div>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {c.experience_years != null ? `${c.experience_years} yrs` : '—'}
                      {c.expected_salary && <p className="text-xs">{formatCurrency(Number(c.expected_salary))} expected</p>}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatDate(c.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <a href={documentsApi.offerLetter(c.id)} target="_blank" rel="noreferrer">
                          <FileText className="h-3.5 w-3.5" /> Offer Letter
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  )
}
