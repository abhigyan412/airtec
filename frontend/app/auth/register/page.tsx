'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GraduationCap, ArrowRight, Loader2, CheckCircle, ArrowLeft } from 'lucide-react'
import { authApi } from '@/lib/api'
import { toast } from 'sonner'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const STEPS = ['School Info', 'Admin Account', 'Done']

export default function RegisterPage() {
  const [step, setStep] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const [form, setForm] = useState({
    school_name: '',
    school_city: '',
    school_state: '',
    school_phone: '',
    affiliation_board: '',
    full_name: '',
    email: '',
    password: '',
    confirm_password: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (form.password !== form.confirm_password) {
      toast.error('Passwords do not match')
      return
    }
    setIsLoading(true)
    try {
      await authApi.registerSchool(form)
      setStep(2)
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Registration failed')
    } finally {
      setIsLoading(false)
    }
  }

  if (step === 2) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <CheckCircle className="h-9 w-9 text-success" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-foreground">School registered!</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{form.school_name}</span> is ready.<br />
            Your admin account has been created.
          </p>
          <div className="mb-6 space-y-2 rounded-xl bg-muted p-4 text-left">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Login credentials</p>
            <p className="text-sm text-foreground"><span className="text-muted-foreground">Email:</span> {form.email}</p>
            <p className="text-sm text-foreground"><span className="text-muted-foreground">Password:</span> {'•'.repeat(form.password.length)}</p>
          </div>
          <Button onClick={() => router.push('/auth/login')} className="w-full" size="lg">
            Go to Login <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-900 p-12 lg:flex lg:w-[45%]">
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute left-0 top-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-white" />
        </div>
        <div className="relative">
          <div className="mb-16 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <GraduationCap className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">AIRTEC</span>
          </div>
          <h2 className="mb-4 text-4xl font-bold leading-tight text-white">
            Set up your school<br />in 2 minutes
          </h2>
          <p className="mb-10 text-lg leading-relaxed text-indigo-200">
            Everything is ready the moment you register — classes, houses, fee heads, and your admin account.
          </p>
          <div className="space-y-4">
            {['Classes 1–12 auto-created', '4 houses pre-configured', 'Default fee heads ready', 'Full admin access instantly'].map(f => (
              <div key={f} className="flex items-center gap-3">
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-400/30">
                  <CheckCircle className="h-3.5 w-3.5 text-indigo-200" />
                </div>
                <span className="text-sm text-indigo-100">{f}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-indigo-200">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-semibold text-white hover:underline">Sign in →</Link>
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-lg">
          {/* Step indicator */}
          <div className="mb-8 flex items-center gap-2">
            {STEPS.slice(0, 2).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all',
                  i < step ? 'bg-primary text-primary-foreground' :
                  i === step ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
                  'bg-muted text-muted-foreground',
                )}>
                  {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
                </div>
                <span className={cn('text-sm font-medium', i === step ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
                {i < 1 && <div className={cn('mx-1 h-0.5 w-8', i < step ? 'bg-primary' : 'bg-muted')} />}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-xl font-bold text-foreground">School information</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Tell us about your school</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="school_name">School name *</Label>
                  <Input id="school_name" value={form.school_name} onChange={e => set('school_name', e.target.value)}
                    placeholder="e.g. Delhi Public School" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="school_city">City</Label>
                    <Input id="school_city" value={form.school_city} onChange={e => set('school_city', e.target.value)}
                      placeholder="Lucknow" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="school_state">State</Label>
                    <Input id="school_state" value={form.school_state} onChange={e => set('school_state', e.target.value)}
                      placeholder="Uttar Pradesh" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="school_phone">Phone</Label>
                    <Input id="school_phone" value={form.school_phone} onChange={e => set('school_phone', e.target.value)}
                      placeholder="+91 98765 43210" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="affiliation_board">Board</Label>
                    <Select value={form.affiliation_board || undefined} onValueChange={v => set('affiliation_board', v)}>
                      <SelectTrigger id="affiliation_board">
                        <SelectValue placeholder="Select board" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CBSE">CBSE</SelectItem>
                        <SelectItem value="ICSE">ICSE</SelectItem>
                        <SelectItem value="UP Board">UP Board</SelectItem>
                        <SelectItem value="State Board">State Board</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={() => setStep(1)} disabled={!form.school_name} className="mt-2 w-full" size="lg">
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <button onClick={() => setStep(0)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <h1 className="text-xl font-bold text-foreground">Admin account</h1>
                  <p className="mt-1 text-sm text-muted-foreground">This will be your login</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="full_name">Your full name *</Label>
                  <Input id="full_name" value={form.full_name} onChange={e => set('full_name', e.target.value)}
                    placeholder="e.g. Rajesh Kumar" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address *</Label>
                  <Input id="email" type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    placeholder="admin@yourschool.com" autoComplete="email" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password *</Label>
                    <Input id="password" type="password" value={form.password} onChange={e => set('password', e.target.value)}
                      placeholder="Min. 8 characters" autoComplete="new-password" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm_password">Confirm *</Label>
                    <Input id="confirm_password" type="password" value={form.confirm_password} onChange={e => set('confirm_password', e.target.value)}
                      placeholder="Repeat password" autoComplete="new-password"
                      className={cn(form.confirm_password && form.confirm_password !== form.password && 'border-destructive focus-visible:ring-destructive')} />
                  </div>
                </div>
                <Button
                  onClick={handleSubmit}
                  disabled={isLoading || !form.full_name || !form.email || !form.password || form.password !== form.confirm_password}
                  className="mt-2 w-full"
                  size="lg"
                >
                  {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Registering…</> : <>Register school <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/auth/login" className="font-semibold text-primary hover:underline">Sign in →</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
