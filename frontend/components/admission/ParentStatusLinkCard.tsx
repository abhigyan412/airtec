'use client'
import { useState } from 'react'
import { Copy, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// remaining-work-plan.md Section B1/B3: the parent-facing status/slot-booking
// link is only ever shown to a parent once — on the public form's own
// success screen, right after they submit. Found live: there was nowhere
// for staff to retrieve or re-send that same link, so a parent who closed
// that screen (or never saw it, e.g. a counselor typed the inquiry in by
// hand) had no way back to it, and staff had no way to help them — a real
// dead end this card closes. No SMS/WhatsApp automation exists yet (still
// deliberately parked), so "share" here means copy-and-send by hand, the
// same manual-fallback pattern already used for waitlist offer follow-up.
// Shared by both the inquiry detail page and the application detail page
// (once an inquiry converts, staff work from the application instead, but
// the link is still keyed by the same inquiry_id underneath).
export function ParentStatusLinkCard({ schoolId, inquiryId }: { schoolId: string, inquiryId: string }) {
  const [copied, setCopied] = useState(false)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/apply/${schoolId}/status/${inquiryId}` : ''

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied — share it with the parent')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — copy it manually instead')
    }
  }

  return (
    <Card>
      <CardContent className="pt-5 space-y-2.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" /> Parent Status Link
        </p>
        <p className="text-xs text-muted-foreground">
          Lets the parent check status, upload documents, and book an entrance-test slot themselves — no login needed. Share it by call, WhatsApp, or email.
        </p>
        <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-[11px] text-foreground">{url}</p>
        <Button variant="outline" size="sm" onClick={copyLink}>
          <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy Link'}
        </Button>
      </CardContent>
    </Card>
  )
}
