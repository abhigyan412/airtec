'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap, Loader2, CheckCircle2, CalendarClock, ArrowRight } from 'lucide-react'
import { publicAdmissionApi } from '@/lib/publicApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

// Public, unauthenticated — this route lives outside app/(app)/, which is
// the only thing that makes a page public in this codebase (see (app)/layout.tsx's
// own auth redirect, scoped to that route group only). No middleware, no
// exemption flag, nothing else to wire up for that part.
export default function PublicAdmissionFormPage() {
  const params = useParams<{ schoolId: string }>()
  const schoolId = params.schoolId

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-admission-info', schoolId],
    queryFn: () => publicAdmissionApi.info(schoolId).then(r => r.data),
    retry: false,
  })

  const [submitted, setSubmitted] = useState<{ inquiryNumber: string | null; inquiryId: string | null } | null>(null)

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel — same pattern as the staff login page, so this reads
          as the same product, not a bolted-on microsite. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-900 p-12 lg:flex lg:w-[42%]">
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute left-0 top-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-white" />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            {data?.school_name ?? 'Admissions'}
          </span>
        </div>
        <div className="relative space-y-4">
          <h2 className="text-4xl font-bold leading-tight text-white">
            Start your child&apos;s
            <br />
            admission journey.
          </h2>
          <p className="text-lg leading-relaxed text-indigo-200">
            Fill in a few details and our admissions team will reach out to guide you through the next steps.
          </p>
        </div>
        <p className="relative text-xs text-indigo-200">Powered by AIRTEC</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow-indigo">
              <GraduationCap className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">{data?.school_name ?? 'Admissions'}</span>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !data ? (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
              <h1 className="text-lg font-bold text-foreground">Admission form not found</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This link doesn&apos;t look right. Please check with the school for the correct admission link.
              </p>
            </div>
          ) : submitted ? (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
              <h1 className="mt-3 text-xl font-bold text-foreground">Thank you!</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your enquiry has been received. Our admissions team will contact you soon.
              </p>
              {submitted.inquiryNumber && (
                <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-foreground">
                  Reference: {submitted.inquiryNumber}
                </p>
              )}
              {submitted.inquiryId && (
                <Button asChild variant="outline" className="mt-4 w-full">
                  <a href={`/apply/${schoolId}/status/${submitted.inquiryId}`}>
                    Check Application Status <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          ) : data.cycle.state !== 'open' ? (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
              <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
              <h1 className="mt-3 text-lg font-bold text-foreground">
                {data.cycle.state === 'not_open' ? 'Admissions have not opened yet' : 'Admissions are closed'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.cycle.state === 'not_open' && data.cycle.opens_at
                  ? `Admissions open on ${new Date(data.cycle.opens_at).toLocaleDateString()}. Please check back then.`
                  : data.cycle.closes_at
                    ? `Admissions closed on ${new Date(data.cycle.closes_at).toLocaleDateString()}. Please contact the school directly for further assistance.`
                    : 'Please contact the school directly for further assistance.'}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Admission Enquiry</h1>
                <p className="mt-1 text-sm text-muted-foreground">Tell us a little about your child — we&apos;ll take it from here.</p>
              </div>
              <InquiryForm schoolId={schoolId} classes={data.classes} onSubmitted={(inquiryNumber, inquiryId) => setSubmitted({ inquiryNumber, inquiryId })} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function InquiryForm({ schoolId, classes, onSubmitted }: {
  schoolId: string
  classes: { id: string; name: string; numeric_level: number | null }[]
  onSubmitted: (inquiryNumber: string | null, inquiryId: string | null) => void
}) {
  const [form, setForm] = useState({
    student_name: '', date_of_birth: '', gender: '',
    parent_name: '', parent_phone: '', parent_email: '',
    applying_for_class_id: '', previous_school: '', notes: '',
    company: '', // honeypot — never shown, never filled by a real visitor
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.student_name.trim() || !form.parent_name.trim() || !form.parent_phone.trim()) {
      setError('Please fill in the required fields.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? undefined : v]))
      const res = await publicAdmissionApi.submitInquiry(schoolId, clean as any)
      onSubmitted(res.inquiry_number ?? null, res.inquiry_id ?? null)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Something went wrong — please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Honeypot — visually and structurally hidden from real users;
            a bot that fills every field populates it. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="company">Company</label>
          <input id="company" name="company" tabIndex={-1} autoComplete="off"
            value={form.company} onChange={e => set('company')(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="student_name">Student&apos;s Full Name *</Label>
          <Input id="student_name" value={form.student_name} onChange={e => set('student_name')(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="dob">Date of Birth</Label>
            <Input id="dob" type="date" value={form.date_of_birth} onChange={e => set('date_of_birth')(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={form.gender} onValueChange={set('gender')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Applying for Class *</Label>
          <Select value={form.applying_for_class_id} onValueChange={set('applying_for_class_id')}>
            <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="parent_name">Parent / Guardian Name *</Label>
          <Input id="parent_name" value={form.parent_name} onChange={e => set('parent_name')(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="parent_phone">Phone *</Label>
            <Input id="parent_phone" type="tel" value={form.parent_phone} onChange={e => set('parent_phone')(e.target.value)}
              placeholder="+91 98765 43210" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="parent_email">Email</Label>
            <Input id="parent_email" type="email" value={form.parent_email} onChange={e => set('parent_email')(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="previous_school">Current / Previous School</Label>
          <Input id="previous_school" value={form.previous_school} onChange={e => set('previous_school')(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Message (optional)</Label>
          <Textarea id="notes" rows={3} className="resize-none" value={form.notes} onChange={e => set('notes')(e.target.value)}
            placeholder="Anything you'd like us to know" />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full" size="lg">
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : 'Submit Enquiry'}
        </Button>
      </form>
    </div>
  )
}
