'use client'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Plus, Users, Edit3, GraduationCap } from 'lucide-react'
import Link from 'next/link'
import { studentsApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn, STATUS_COLORS, formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export default function StudentsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermissions()
  // Seeded from ?search= so the header's global search lands here with the
  // query already applied.
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const q = searchParams.get('search') ?? ''
    setSearch(q)
    setPage(1)
  }, [searchParams])

  const { data, isLoading } = useQuery({
    queryKey: ['students', { search, status, page }],
    queryFn: () => studentsApi.list({ search: search || undefined, status: status || undefined, page, limit: 25 }),
    placeholderData: (prev: any) => prev,
  })

  const students = data?.data ?? []
  const meta = data?.meta ?? { total: 0, page: 1, limit: 25 }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description={`${meta.total} total students`}
        icon={Users}
        actions={
          <>
            {can('student.promote') && (
              <Button variant="outline" asChild>
                <Link href="/students/promote">
                  <GraduationCap className="h-4 w-4" /> Promote / Transfer
                </Link>
              </Button>
            )}
            {can('student.edit') && (
              <Button variant="outline" asChild>
                <Link href="/students/bulk-edit">
                  <Edit3 className="h-4 w-4" /> Bulk Edit
                </Link>
              </Button>
            )}
            {can('student.create') && (
              <Button asChild>
                <Link href="/students/new">
                  <Plus className="h-4 w-4" /> Add Student
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Filters */}
      <Card className="flex flex-wrap gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search name or admission number..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="pl-10"
          />
        </div>
        <Select
          value={status || 'all'}
          onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}
        >
          <SelectTrigger className="min-w-[140px] sm:w-[160px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="transferred">Transferred</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No students found"
            description="Add your first student to get started"
            action={
              can('student.create') ? (
                <Button asChild>
                  <Link href="/students/new">
                    <Plus className="h-4 w-4" /> Add Student
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden md:table-cell">Admission No.</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="hidden md:table-cell">House</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Joined</TableHead>
                  <TableHead className="hidden md:table-cell" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s: any) => (
                  <TableRow
                    key={s.id}
                    onClick={() => router.push(`/students/${s.id}`)}
                    className="group"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          {s.photo_url && <AvatarImage src={s.photo_url} alt="" />}
                          <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                            {s.first_name[0]}{s.last_name[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold text-foreground transition-colors group-hover:text-primary">{s.first_name} {s.last_name}</p>
                          <p className="text-xs capitalize text-muted-foreground">{s.gender ?? '—'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="rounded-lg bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">{s.admission_number ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.classes?.name ?? '—'}
                      {s.sections?.name && <span className="text-muted-foreground/70"> · {s.sections.name}</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {s.houses
                        ? <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ backgroundColor: s.houses.color ?? '#6366f1' }}>
                            <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
                            {s.houses.name}
                          </span>
                        : <span className="text-muted-foreground/50">—</span>
                      }
                    </TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold capitalize', STATUS_COLORS[s.status])}>
                        {s.status}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        View →
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {meta.total > meta.limit && (
              <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3.5 text-sm text-muted-foreground">
                <p className="text-xs">Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * meta.limit >= meta.total}>Next →</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
