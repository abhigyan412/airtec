'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download } from 'lucide-react'
import { libraryApi } from '@/lib/api'
import { downloadCsv } from '@/lib/csv'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

function toCsvRows(rows: Record<string, any>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\r\n')
}

export default function LibraryReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Defaulters, demand, collection value, and the RTE distribution audit export." icon={BarChart3} className="mb-0" />
      <Tabs defaultValue="Defaulters">
        <TabsList>
          <TabsTrigger value="Defaulters">Defaulters</TabsTrigger>
          <TabsTrigger value="MostBorrowed">Most Borrowed</TabsTrigger>
          <TabsTrigger value="Valuation">Valuation</TabsTrigger>
          <TabsTrigger value="TextbookAudit">Textbook Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="Defaulters" className="mt-6"><DefaultersTab /></TabsContent>
        <TabsContent value="MostBorrowed" className="mt-6"><MostBorrowedTab /></TabsContent>
        <TabsContent value="Valuation" className="mt-6"><ValuationTab /></TabsContent>
        <TabsContent value="TextbookAudit" className="mt-6"><TextbookAuditTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function DefaultersTab() {
  const { data, isLoading } = useQuery({ queryKey: ['library-report-defaulters'], queryFn: () => libraryApi.reports.defaulters().then(r => r.data) })
  return (
    <Card className="overflow-hidden">
      {isLoading ? <div className="p-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Borrower</TableHead><TableHead>Book</TableHead><TableHead>Due Date</TableHead><TableHead>Days Overdue</TableHead><TableHead>Fine</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No overdue books — a clean slate.</TableCell></TableRow>}
            {(data ?? []).map((d: any) => (
              <TableRow key={d.loan_id}>
                <TableCell className="font-medium">{d.borrower}</TableCell>
                <TableCell>{d.title} <span className="text-muted-foreground">({d.accession_no})</span></TableCell>
                <TableCell>{d.due_date}</TableCell>
                <TableCell><Badge variant="destructive">{d.days_overdue}d</Badge></TableCell>
                <TableCell>{d.fine ? `₹${Number(d.fine.amount).toLocaleString()} (${d.fine.status})` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

function MostBorrowedTab() {
  const { data, isLoading } = useQuery({ queryKey: ['library-report-most-borrowed'], queryFn: () => libraryApi.reports.mostBorrowed().then(r => r.data) })
  return (
    <Card className="overflow-hidden">
      {isLoading ? <div className="p-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Times Borrowed</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No loans recorded yet.</TableCell></TableRow>}
            {(data ?? []).map((d: any, i: number) => (
              <TableRow key={i}><TableCell className="font-medium">{d.title}</TableCell><TableCell className="capitalize text-muted-foreground">{d.category}</TableCell><TableCell>{d.count}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

function ValuationTab() {
  const { data, isLoading } = useQuery({ queryKey: ['library-report-valuation'], queryFn: () => libraryApi.reports.valuation().then(r => r.data) })
  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4"><p className="text-sm text-muted-foreground">Total Copies</p><p className="text-2xl font-semibold">{data.total_copies}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted-foreground">Collection Value</p><p className="text-2xl font-semibold">₹{Number(data.total_value).toLocaleString()}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted-foreground">Lost — Written Off</p><p className="text-2xl font-semibold text-destructive">₹{Number(data.lost_value).toLocaleString()}</p></Card>
      </div>
      <Card className="overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium">By Category</div>
        <Table>
          <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Copies</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
          <TableBody>
            {Object.entries(data.by_category).map(([cat, v]: any) => (
              <TableRow key={cat}><TableCell className="capitalize">{cat}</TableCell><TableCell>{v.count}</TableCell><TableCell>₹{Number(v.value).toLocaleString()}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Card className="overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium">By Status</div>
        <Table>
          <TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Copies</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
          <TableBody>
            {Object.entries(data.by_status).map(([st, v]: any) => (
              <TableRow key={st}><TableCell className="capitalize">{st}</TableCell><TableCell>{v.count}</TableCell><TableCell>₹{Number(v.value).toLocaleString()}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function TextbookAuditTab() {
  const { data, isLoading } = useQuery({ queryKey: ['library-report-textbook-audit'], queryFn: () => libraryApi.reports.textbookAudit().then(r => r.data) })

  const exportCsv = () => {
    const rows = (data ?? []).map((d: any) => ({
      student: d.students ? `${d.students.first_name} ${d.students.last_name}` : '',
      admission_number: d.students?.admission_number ?? '',
      class: d.students?.classes?.name ?? '',
      book: d.book_name, quantity: d.quantity, scheme: d.scheme,
      distributed_at: new Date(d.distributed_at).toLocaleDateString(),
    }))
    downloadCsv('textbook-distribution-audit.csv', toCsvRows(rows))
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">The compliance record inspectors ask for — who received what, under which scheme.</p>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data?.length}><Download className="h-4 w-4" /> Export CSV</Button>
      </div>
      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Class</TableHead><TableHead>Book</TableHead><TableHead>Qty</TableHead><TableHead>Scheme</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No records yet.</TableCell></TableRow>}
            {(data ?? []).map((d: any, i: number) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{d.students ? `${d.students.first_name} ${d.students.last_name}` : '—'}</TableCell>
                <TableCell>{d.students?.classes?.name ?? '—'}</TableCell>
                <TableCell>{d.book_name}</TableCell>
                <TableCell>{d.quantity}</TableCell>
                <TableCell className="capitalize">{d.scheme.replace(/_/g, ' ')}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(d.distributed_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
