'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi, calendarApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Single shared "Apply for Leave" modal — used by both /hr/my-leave and
// /hr/leave, which previously had their own independent copies. The
// older /hr/leave copy did a naive calendar-day count with no
// holiday/weekly-off awareness, so its on-screen preview could disagree
// with what the backend actually deducted. This is the one source of
// truth for that preview now.
export function ApplyLeaveModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const { data: leaveTypes } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => hrmsApi.leaveTypes.list().then(r => r.data),
  })

  // Working-day math mirrors the backend exactly (shared academic
  // calendar: weekly-off + holidays) so what the staff member sees here
  // matches what actually gets deducted from their leave balance.
  const { data: holidays } = useQuery({
    queryKey: ['holidays-all'],
    queryFn: () => calendarApi.holidays.list().then(r => r.data),
  })
  const { data: weeklyOffData } = useQuery({
    queryKey: ['weekly-off'],
    queryFn: () => calendarApi.weeklyOff.get().then(r => r.data),
  })
  const { data: balances } = useQuery({
    queryKey: ['my-leave-balances', user?.id],
    queryFn: () => hrmsApi.leaveBalances(user!.id).then(r => r.data),
    enabled: !!user,
  })

  const [form, setForm] = useState({
    leave_type_id: '',
    from_date: '',
    to_date: '',
    reason: '',
  })
  const [loading, setLoading] = useState(false)

  const { totalDays, excludedCount } = (() => {
    if (!form.from_date || !form.to_date || form.to_date < form.from_date) return { totalDays: 0, excludedCount: 0 }
    const holidaySet = new Set((holidays ?? []).map((h: any) => h.date))
    const weeklyOff = new Set<number>(weeklyOffData?.weekly_off_days ?? [0])

    let working = 0, excluded = 0
    const cur = new Date(`${form.from_date}T00:00:00`)
    const end = new Date(`${form.to_date}T00:00:00`)
    while (cur <= end) {
      // Local date string, not cur.toISOString().slice(0, 10) — that
      // converts to UTC first, which shifts the date backward a full
      // day in any timezone ahead of UTC (e.g. IST) and silently
      // checked the wrong date against the holiday list.
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      const isOff = holidaySet.has(key) || weeklyOff.has(cur.getDay())
      if (isOff) excluded++
      else working++
      cur.setDate(cur.getDate() + 1)
    }
    return { totalDays: working, excludedCount: excluded }
  })()

  const selectedBalance = (balances ?? []).find((b: any) => b.leave_type_id === form.leave_type_id)
  const exceedsBalance = !!selectedBalance && totalDays > selectedBalance.remaining_days

  const handleSubmit = async () => {
    if (!form.leave_type_id || !form.from_date || !form.to_date) {
      return toast.error('Please fill all required fields')
    }
    if (form.to_date < form.from_date) return toast.error('To date must be on or after from date')
    if (totalDays <= 0) return toast.error('Selected range has no working days (all holidays/weekly-off)')

    setLoading(true)
    try {
      const res = await hrmsApi.leaveRequests.create(form)
      if (res.data?.exceeds_balance) {
        toast.warning(`Submitted — this exceeds your remaining balance (${res.data.remaining_days_before} day${res.data.remaining_days_before === 1 ? '' : 's'} left). It'll need to be approved as leave-without-pay.`)
      } else {
        toast.success('Leave application submitted!')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to submit')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apply for Leave</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Leave Type *</Label>
            <Select
              value={form.leave_type_id}
              onValueChange={(v) => setForm(f => ({ ...f, leave_type_id: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select leave type" />
              </SelectTrigger>
              <SelectContent>
                {(leaveTypes ?? []).map((lt: any) => (
                  <SelectItem key={lt.id} value={lt.id}>{lt.name} {lt.is_paid ? '(Paid)' : '(Unpaid)'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBalance && (
              <p className="mt-1 text-xs text-muted-foreground">{selectedBalance.remaining_days} of {selectedBalance.total_days} days remaining</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="from_date">From Date *</Label>
              <Input id="from_date" type="date" value={form.from_date}
                onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to_date">To Date *</Label>
              <Input id="to_date" type="date" value={form.to_date}
                onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} />
            </div>
          </div>

          {totalDays > 0 && (
            <p className="text-sm font-medium text-primary">
              {totalDays} working day{totalDays !== 1 ? 's' : ''} requested
              {excludedCount > 0 && (
                <span className="font-normal text-muted-foreground"> · {excludedCount} holiday/weekly-off day{excludedCount !== 1 ? 's' : ''} in range not counted</span>
              )}
            </p>
          )}
          {form.from_date && form.to_date && form.to_date >= form.from_date && totalDays === 0 && (
            <p className="text-sm font-medium text-destructive">Selected range is entirely holidays/weekly-off — nothing to apply for</p>
          )}
          {exceedsBalance && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
              <p className="text-xs text-warning">
                This exceeds your remaining balance of {selectedBalance.remaining_days} day{selectedBalance.remaining_days === 1 ? '' : 's'}.
                You can still submit it, but it'll be flagged for the approver as going past your quota.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={3} className="resize-none" value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Brief reason for leave..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit Application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
