'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { CalendarClock, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'

// Shared by both the inquiry detail page (inquiryId) and the application
// detail page (applicationId) — entrance-test booking is designed to
// happen at inquiry stage (it's what auto-advances inquiry status), but
// interviews/tours can just as reasonably be booked once an application
// exists, so both surfaces get the same widget.
//
// alsoInquiryId: converting an inquiry to an application never relinks its
// existing slot bookings (they keep inquiry_id, application_id stays
// null) — pass the application's own inquiry_id here so its booking
// history still shows on the application page, not just the inquiry page.
// It only affects what's fetched, never what a *new* booking attaches to
// (that's still governed by inquiryId/applicationId below).
export function SlotBookingCard({ inquiryId, applicationId, classId, alsoInquiryId }: { inquiryId?: string; applicationId?: string; classId?: string; alsoInquiryId?: string }) {
  const qc = useQueryClient()
  const [showBook, setShowBook] = useState(false)
  const queryKey = ['admission-slot-bookings', inquiryId ?? applicationId, alsoInquiryId ?? '']

  const { data: bookings, isLoading } = useQuery({
    queryKey,
    queryFn: () => admissionApi.slotBookings.list({
      ...(inquiryId ? { inquiry_id: inquiryId } : {}),
      ...(applicationId ? { application_id: applicationId } : {}),
      ...(!inquiryId && alsoInquiryId ? { inquiry_id: alsoInquiryId } : {}),
    }).then(r => r.data),
  })

  return (
    <Card>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-muted-foreground" /> Test / Interview Bookings
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setShowBook(true)} className="text-primary hover:text-primary">
          <Plus className="w-4 h-4" /> Book a Slot
        </Button>
      </div>
      {isLoading ? (
        <div className="p-6"><Skeleton className="h-12 w-full rounded-xl" /></div>
      ) : !(bookings ?? []).length ? (
        <EmptyState icon={CalendarClock} title="No bookings yet" description="Book this candidate into an entrance test, interview, or campus tour slot." className="py-8" />
      ) : (
        <div className="divide-y divide-border">
          {(bookings ?? []).map((b: any) => (
            <div key={b.id} className="flex items-center justify-between px-6 py-3.5">
              <div>
                <p className="text-sm font-medium text-foreground">{b.admission_slots?.title}</p>
                <p className="text-xs text-muted-foreground">{b.admission_slots?.starts_at && formatDate(b.admission_slots.starts_at)}</p>
              </div>
              <Badge variant={b.status === 'attended' ? 'success' : b.status === 'no_show' ? 'warning' : b.status === 'cancelled' ? 'destructive' : 'info'} className="capitalize">
                {b.status.replace('_', ' ')}
              </Badge>
            </div>
          ))}
        </div>
      )}
      {showBook && (
        <BookSlotModal
          inquiryId={inquiryId} applicationId={applicationId} classId={classId}
          onClose={() => { setShowBook(false); qc.invalidateQueries({ queryKey }) }}
        />
      )}
    </Card>
  )
}

function BookSlotModal({ inquiryId, applicationId, classId, onClose }: { inquiryId?: string; applicationId?: string; classId?: string; onClose: () => void }) {
  const [slotId, setSlotId] = useState('')
  const [saving, setSaving] = useState(false)

  // Strictly filtered to slots generated for the class the candidate is
  // actually applying for — a slot from a different class isn't a valid
  // booking target for this candidate.
  const { data: slots } = useQuery({
    queryKey: ['admission-slots', 'upcoming', classId],
    queryFn: () => admissionApi.slots.list({ from: new Date().toISOString(), ...(classId ? { class_id: classId } : {}) }).then(r => r.data),
  })

  const handleBook = async () => {
    if (!slotId) return toast.error('Select a slot')
    setSaving(true)
    try {
      await admissionApi.slots.book(slotId, inquiryId ? { inquiry_id: inquiryId } : { application_id: applicationId })
      toast.success('Booked')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to book slot')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Book a Slot</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {!(slots ?? []).length ? (
            <p className="text-sm text-muted-foreground">
              {classId ? 'No upcoming slots for this class — create one from the Slots page first.' : 'No upcoming slots — create one from the Slots page first.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label>Slot</Label>
              <Select value={slotId} onValueChange={setSlotId}>
                <SelectTrigger><SelectValue placeholder="Select a slot" /></SelectTrigger>
                <SelectContent>
                  {(slots ?? []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.title} — {formatDate(s.starts_at)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleBook} disabled={saving || !slotId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Book'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
