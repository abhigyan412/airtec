'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, Loader2, CheckCircle2, Paperclip } from 'lucide-react'
import { publicRecruitmentApi } from '@/lib/publicApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

// Public, unauthenticated — same rule as /apply/[schoolId]: living outside
// app/(app)/ is the only thing that makes a route public in this codebase.
export default function PublicCareersPage() {
  const params = useParams<{ schoolId: string }>()
  const schoolId = params.schoolId

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-recruitment-info', schoolId],
    queryFn: () => publicRecruitmentApi.info(schoolId).then(r => r.data),
    retry: false,
  })

  const [submitted, setSubmitted] = useState<{ applicationNumber: string | null } | null>(null)

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel — same pattern as the admission form's, so this reads
          as the same product, not a bolted-on microsite. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-900 p-12 lg:flex lg:w-[42%]">
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute left-0 top-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-white" />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <Briefcase className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            {data?.school_name ?? 'Careers'}
          </span>
        </div>
        <div className="relative space-y-4">
          <h2 className="text-4xl font-bold leading-tight text-white">
            Come teach
            <br />
            with us.
          </h2>
          <p className="text-lg leading-relaxed text-indigo-200">
            Tell us a little about yourself and our HR team will be in touch about the next steps.
          </p>
        </div>
        <p className="relative text-xs text-indigo-200">Powered by AIRTEC</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow-indigo">
              <Briefcase className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">{data?.school_name ?? 'Careers'}</span>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !data ? (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
              <h1 className="text-lg font-bold text-foreground">Application form not found</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This link doesn&apos;t look right. Please check with the school for the correct careers link.
              </p>
            </div>
          ) : submitted ? (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
              <h1 className="mt-3 text-xl font-bold text-foreground">Thank you!</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your application has been received. Our HR team will reach out if there&apos;s a fit.
              </p>
              {submitted.applicationNumber && (
                <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-foreground">
                  Reference: {submitted.applicationNumber}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Apply to Join Our Team</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.postings?.length ? 'Pick an open position, or apply generally.' : "We don't have any open positions listed right now, but we're always happy to hear from good candidates."}
                </p>
              </div>
              <ApplicationForm schoolId={schoolId} postings={data.postings ?? []} onSubmitted={applicationNumber => setSubmitted({ applicationNumber })} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ApplicationForm({ schoolId, postings, onSubmitted }: {
  schoolId: string
  postings: { id: string; title: string; department: string | null; designation: string | null }[]
  onSubmitted: (applicationNumber: string | null) => void
}) {
  const [form, setForm] = useState({
    candidate_name: '', phone: '', email: '', job_posting_id: '',
    current_designation: '', experience_years: '', expected_salary: '', notice_period: '', cover_letter: '',
    company: '', // honeypot — never shown, never filled by a real visitor
  })
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.candidate_name.trim() || !form.phone.trim()) {
      setError('Please fill in the required fields.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      let resumeFields: { resume_base64?: string; resume_file_name?: string; resume_mime_type?: string } = {}
      if (file) {
        resumeFields = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ resume_base64: reader.result as string, resume_file_name: file.name, resume_mime_type: file.type })
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }
      const res = await publicRecruitmentApi.submitApplication(schoolId, {
        candidate_name: form.candidate_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        job_posting_id: form.job_posting_id || undefined,
        current_designation: form.current_designation.trim() || undefined,
        experience_years: form.experience_years ? Number(form.experience_years) : undefined,
        expected_salary: form.expected_salary ? Number(form.expected_salary) : undefined,
        notice_period: form.notice_period.trim() || undefined,
        cover_letter: form.cover_letter.trim() || undefined,
        company: form.company || undefined,
        ...resumeFields,
      })
      onSubmitted(res.application_number ?? null)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

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
          <Label htmlFor="candidate_name">Full Name *</Label>
          <Input id="candidate_name" value={form.candidate_name} onChange={e => set('candidate_name')(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone *</Label>
            <Input id="phone" type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} placeholder="+91 98765 43210" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={e => set('email')(e.target.value)} />
          </div>
        </div>

        {postings.length > 0 && (
          <div className="space-y-1.5">
            <Label>Position</Label>
            <Select value={form.job_posting_id} onValueChange={set('job_posting_id')}>
              <SelectTrigger><SelectValue placeholder="General Application" /></SelectTrigger>
              <SelectContent>
                {postings.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.title}{p.department ? ` — ${p.department}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="current_designation">Current Role</Label>
            <Input id="current_designation" value={form.current_designation} onChange={e => set('current_designation')(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="experience_years">Experience (yrs)</Label>
            <Input id="experience_years" type="number" min={0} value={form.experience_years} onChange={e => set('experience_years')(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="expected_salary">Expected Salary</Label>
            <Input id="expected_salary" type="number" min={0} value={form.expected_salary} onChange={e => set('expected_salary')(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notice_period">Notice Period</Label>
            <Input id="notice_period" value={form.notice_period} onChange={e => set('notice_period')(e.target.value)} placeholder="e.g. 30 days" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cover_letter">Cover Letter (optional)</Label>
          <Textarea id="cover_letter" rows={3} className="resize-none" value={form.cover_letter} onChange={e => set('cover_letter')(e.target.value)}
            placeholder="Why you'd be a good fit" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="resume">Resume (optional)</Label>
          <label htmlFor="resume" className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:border-primary/40">
            <Paperclip className="h-4 w-4 shrink-0" />
            {file ? file.name : 'Attach a PDF or Word document'}
          </label>
          <input id="resume" type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full" size="lg">
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : 'Submit Application'}
        </Button>
      </form>
    </div>
  )
}
