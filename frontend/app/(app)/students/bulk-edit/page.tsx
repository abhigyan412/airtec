'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, admissionApi } from '@/lib/api'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { Search, Filter, CheckSquare, Square, Edit3, Loader2, ArrowLeft, Users, ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

const EDIT_FIELDS = [
  { key: 'house_id',    label: 'House',        type: 'house' },
  { key: 'class_id',   label: 'Class',         type: 'class' },
  { key: 'section_id', label: 'Section',       type: 'section' },
  { key: 'status',     label: 'Status',        type: 'status' },
  { key: 'roll_number',label: 'Roll Number',   type: 'text' },
  { key: 'stream',     label: 'Stream',        type: 'stream' },
]

const STATUSES = ['active','inactive','suspended','transferred','passed_out']
const STREAMS  = ['Science','Commerce','Arts','General']

export default function BulkEditPage() {
  const [search, setSearch]               = useState('')
  const [filterClass, setFilterClass]     = useState('')
  const [filterSection, setFilterSection] = useState('')
  const [filterHouse, setFilterHouse]     = useState('')
  const [filterStatus, setFilterStatus]   = useState('active')
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [editField, setEditField]         = useState('')
  const [editValue, setEditValue]         = useState('')
  const [applying, setApplying]           = useState(false)
  const qc = useQueryClient()

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: housesData } = useQuery({
    queryKey: ['houses'],
    queryFn: () => api.get('/students/houses').then(r => r.data.data).catch(() => []),
  })

  const selectedClassObj = (classesData ?? []).find((c: any) => c.id === filterClass)
  const sections = selectedClassObj?.sections ?? []

  const { data: studentsData, isLoading } = useQuery({
    queryKey: ['students-bulk', search, filterClass, filterSection, filterHouse, filterStatus],
    queryFn: () => studentsApi.list({
      search: search || undefined,
      class_id: filterClass || undefined,
      section_id: filterSection || undefined,
      house_id: filterHouse || undefined,
      status: filterStatus || undefined,
      limit: 100,
    }).then(r => r),
  })

  const students = studentsData?.data ?? []

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === students.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(students.map((s: any) => s.id)))
    }
  }

  const applyEdit = async () => {
    if (!editField || !editValue || selected.size === 0) {
      return toast.error('Select students, a field, and a value')
    }
    setApplying(true)
    try {
      await Promise.all(
        Array.from(selected).map(id =>
          studentsApi.update(id, { [editField]: editValue })
        )
      )
      toast.success(`Updated ${selected.size} students`)
      setSelected(new Set())
      setEditField('')
      setEditValue('')
      qc.invalidateQueries({ queryKey: ['students-bulk'] })
      qc.invalidateQueries({ queryKey: ['student-stats'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update')
    } finally {
      setApplying(false)
    }
  }

  // Section options based on edit class
  const editClassObj = (classesData ?? []).find((c: any) => c.id === editValue)
  const editSections = editField === 'class_id' ? editClassObj?.sections ?? [] : []

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to students" className="mt-1 shrink-0">
          <Link href="/students">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Bulk Edit Students"
          description="Filter students, select them, then apply changes to all at once"
          icon={ClipboardList}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Filter className="h-4 w-4" /> Filter Students
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="text" placeholder="Search by name or admission no..."
                value={search} onChange={e => { setSearch(e.target.value); setSelected(new Set()) }}
                className="pl-9" />
            </div>
            <Select value={filterClass || 'all'} onValueChange={v => { setFilterClass(v === 'all' ? '' : v); setFilterSection(''); setSelected(new Set()) }}>
              <SelectTrigger className="min-w-[140px]">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {sections.length > 0 && (
              <Select value={filterSection || 'all'} onValueChange={v => { setFilterSection(v === 'all' ? '' : v); setSelected(new Set()) }}>
                <SelectTrigger className="min-w-[140px]">
                  <SelectValue placeholder="All Sections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={filterHouse || 'all'} onValueChange={v => { setFilterHouse(v === 'all' ? '' : v); setSelected(new Set()) }}>
              <SelectTrigger className="min-w-[140px]">
                <SelectValue placeholder="All Houses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Houses</SelectItem>
                {(housesData ?? []).map((h: any) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus || 'all'} onValueChange={v => { setFilterStatus(v === 'all' ? '' : v); setSelected(new Set()) }}>
              <SelectTrigger className="min-w-[140px]">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Edit action bar */}
      {selected.size > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="flex items-center gap-2 text-foreground">
              <Users className="h-5 w-5 text-primary" />
              <span className="font-semibold">{selected.size} students selected</span>
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <Select value={editField || undefined} onValueChange={v => { setEditField(v); setEditValue('') }}>
                <SelectTrigger className="min-w-[180px]">
                  <SelectValue placeholder="Select field to edit..." />
                </SelectTrigger>
                <SelectContent>
                  {EDIT_FIELDS.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Value selector based on field type */}
              {editField === 'house_id' && (
                <Select value={editValue || undefined} onValueChange={v => setEditValue(v)}>
                  <SelectTrigger className="min-w-[160px]">
                    <SelectValue placeholder="Select house..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(housesData ?? []).map((h: any) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {editField === 'class_id' && (
                <Select value={editValue || undefined} onValueChange={v => setEditValue(v)}>
                  <SelectTrigger className="min-w-[160px]">
                    <SelectValue placeholder="Select class..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {editField === 'section_id' && (
                <Select value={editValue || undefined} onValueChange={v => setEditValue(v)}>
                  <SelectTrigger className="min-w-[160px]">
                    <SelectValue placeholder="Select section..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(classesData ?? []).flatMap((c: any) => c.sections ?? []).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {editField === 'status' && (
                <Select value={editValue || undefined} onValueChange={v => setEditValue(v)}>
                  <SelectTrigger className="min-w-[160px]">
                    <SelectValue placeholder="Select status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {editField === 'stream' && (
                <Select value={editValue || undefined} onValueChange={v => setEditValue(v)}>
                  <SelectTrigger className="min-w-[160px]">
                    <SelectValue placeholder="Select stream..." />
                  </SelectTrigger>
                  <SelectContent>
                    {STREAMS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {editField === 'roll_number' && (
                <Input type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                  placeholder="Enter roll number..." className="max-w-[200px]" />
              )}

              <Button onClick={applyEdit} disabled={applying || !editField || !editValue}>
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
                Apply to {selected.size} students
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Student table */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleAll}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Toggle all students"
            >
              {selected.size === students.length && students.length > 0
                ? <CheckSquare className="h-5 w-5 text-primary" />
                : <Square className="h-5 w-5" />
              }
            </button>
            <span className="text-sm text-muted-foreground">
              {students.length} students found
              {selected.size > 0 && <span className="font-semibold text-primary"> · {selected.size} selected</span>}
            </span>
          </div>
          {students.length > 0 && (
            <Button variant="link" size="sm" onClick={toggleAll} className="h-auto p-0">
              {selected.size === students.length ? 'Deselect all' : 'Select all'}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No students match the filters"
            description="Widen the class, house or status filters — or clear the search box — to find the students you want to edit."
            className="py-12"
          />
        ) : (
          <div className="divide-y divide-border">
            {students.map((s: any) => {
              const isSelected = selected.has(s.id)
              return (
                <button key={s.id}
                  type="button"
                  onClick={() => toggleOne(s.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center gap-4 px-6 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                  )}>
                  <span className="shrink-0 text-muted-foreground">
                    {isSelected
                      ? <CheckSquare className="h-5 w-5 text-primary" />
                      : <Square className="h-5 w-5" />
                    }
                  </span>
                  <Avatar className="h-8 w-8">
                    {s.photo_url && <AvatarImage src={s.photo_url} alt="" />}
                    <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                      {s.first_name?.[0]}{s.last_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{s.first_name} {s.last_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.admission_number && `#${s.admission_number} · `}
                      Roll: {s.roll_number ?? '—'}
                    </p>
                  </div>
                  <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
                    <span>{s.classes?.name ?? '—'}</span>
                    {s.sections?.name && <span>{s.sections.name}</span>}
                    {s.houses && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: s.houses.color ?? '#6366f1' }}>
                        {s.houses.name}
                      </span>
                    )}
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[s.status])}>
                      {s.status}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
