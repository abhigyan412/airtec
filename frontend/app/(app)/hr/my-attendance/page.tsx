'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { CalendarClock, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const STATUS_COLORS: Record<string, string> = {
  present: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  absent: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  half_day: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  on_leave: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20',
}
const REG_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  approved: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  rejected: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
}

export default function MyAttendancePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showRequest, setShowRequest] = useState(false)
  const now = new Date()

  const { data: records, isLoading } = useQuery({
    queryKey: ['my-attendance', user?.id],
    queryFn: () => hrmsApi.attendance.list({ user_id: user?.id, month: now.getMonth() + 1, year: now.getFullYear() }).then(r => r.data),
    enabled: !!user,
  })

  const { data: requests } = useQuery({
    queryKey: ['my-regularizations', user?.id],
    queryFn: () => hrmsApi.regularizations.list({ user_id: user?.id }).then(r => r.data),
    enabled: !!user,
  })

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="My Attendance"
        description="Your attendance this month, and any correction requests"
        icon={CalendarClock}
        actions={
          <Button onClick={() => setShowRequest(true)}>
            <Plus className="h-4 w-4" /> Request Correction
          </Button>
        }
      />

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>This Month</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (records ?? []).length === 0 ? (
            <EmptyState icon={CalendarClock} title="No attendance marked yet this month" description="Once someone marks your daily attendance, it appears here." />
          ) : (
            <div className="divide-y divide-border">
              {(records ?? []).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between px-6 py-3">
                  <span className="text-sm text-foreground">{formatDate(r.date)}</span>
                  <div className="flex items-center gap-3">
                    {(r.check_in || r.check_out) && (
                      <span className="text-xs text-muted-foreground">
                        {r.check_in ? r.check_in.slice(0, 5) : '—'} – {r.check_out ? r.check_out.slice(0, 5) : '—'}
                      </span>
                    )}
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_COLORS[r.status])}>{r.status.replace('_', ' ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(requests ?? []).length > 0 && (
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle>Correction Requests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {(requests ?? []).map((r: any) => (
                <div key={r.id} className="px-6 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{formatDate(r.date)} → {r.requested_status.replace('_', ' ')}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', REG_STATUS_COLORS[r.status])}>{r.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showRequest && (
        <RequestCorrectionModal onClose={() => {
          setShowRequest(false)
          qc.invalidateQueries({ queryKey: ['my-regularizations'] })
        }} />
      )}
    </div>
  )
}

function RequestCorrectionModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ date: '', requested_status: 'present', reason: '' })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.date || !form.reason) return toast.error('Date and reason are required')
    setLoading(true)
    try {
      await hrmsApi.regularizations.request(form)
      toast.success('Correction request submitted')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Request Attendance Correction</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Date *</Label>
            <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Correct Status *</Label>
            <Select value={form.requested_status} onValueChange={v => setForm(f => ({ ...f, requested_status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="half_day">Half Day</SelectItem>
                <SelectItem value="on_leave">On Leave</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reason *</Label>
            <Textarea rows={3} className="resize-none" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why does this day need correcting?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
