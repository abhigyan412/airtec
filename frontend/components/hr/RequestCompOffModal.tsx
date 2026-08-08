'use client'
import { useState } from 'react'
import { hrmsApi } from '@/lib/api'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function RequestCompOffModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ worked_date: '', reason: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!form.worked_date) return toast.error('Select the date you worked')
    setLoading(true)
    try {
      await hrmsApi.compOff.request(form)
      toast.success('Comp-off request submitted')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to submit')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Request Comp-Off</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Date Worked *</Label>
            <Input type="date" value={form.worked_date} onChange={e => setForm(f => ({ ...f, worked_date: e.target.value }))} />
            <p className="text-xs text-muted-foreground">A holiday or weekly-off day you worked on.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea rows={3} className="resize-none" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
