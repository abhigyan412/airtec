'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Loader2, Megaphone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

// A pre-scoped version of Examination Settings -> Announce Exam
// (app/(app)/exams/templates/page.tsx's AnnounceExamTab) for the one place
// a controller actually finishes building a datesheet: the exam's own
// page. No exam picker here — the caller already knows which exam. Kept as
// its own small component rather than sharing one with AnnounceExamTab,
// since the only logic in common is a single mutation call; the dialog
// chrome and the full-tab-card-with-picker layout genuinely differ.
export function AnnounceExamDialog({ examId, examName, open, onOpenChange }: {
  examId: string; examName: string; open: boolean; onOpenChange: (open: boolean) => void
}) {
  const [message, setMessage] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/announce`, { message: message.trim() || undefined }),
    onSuccess: (res: any) => {
      const { students_notified } = res.data.data
      toast.success(students_notified > 0
        ? `Announced to ${students_notified} student${students_notified === 1 ? '' : 's'} and their parents.`
        : 'Announced — no students currently in this datesheet\'s classes.')
      setMessage('')
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to send announcement'),
  })

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) setMessage(''); onOpenChange(o) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Announce "{examName}"</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Notify every student and parent in this exam's datesheet that it's out — reaches only the
          classes (and, for 11th/12th, the exact streams) actually scheduled.
        </p>
        <div className="space-y-1.5">
          <Label>Message (optional)</Label>
          <Textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={`Your "${examName}" datesheet is now available. Check your schedule.`}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">Leave blank to send the default message shown above.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Send Announcement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
