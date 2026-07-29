'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GraduationCap, Eye, EyeOff, Loader2 } from 'lucide-react'

import { useAuth, NON_STAFF_ROLES } from '@/lib/auth'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const STATS = [
  { num: '10K+', label: 'Students managed' },
  { num: '50+', label: 'Schools onboarded' },
  { num: '₹2Cr+', label: 'Fees processed' },
  { num: '99.9%', label: 'Uptime' },
]

const FAMILY_APP_URL = process.env.NEXT_PUBLIC_FAMILY_APP_URL ?? 'http://localhost:3001'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { login, logout } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanEmail = email.trim()
    const cleanPassword = password.trim()
    if (!cleanEmail || !cleanPassword) return
    setIsLoading(true)
    try {
      const user = await login(cleanEmail, cleanPassword)
      if (NON_STAFF_ROLES.includes(user.role)) {
        // Wrong app — parents/students now have their own separate
        // portal. Don't leave them signed in here with nothing to see.
        toast.error('Parents and students should sign in at the family portal.')
        logout()
        window.location.href = FAMILY_APP_URL
        return
      }
      toast.success('Welcome back!')
      router.push('/dashboard')
    } catch (err: any) {
      // No response at all (server down / unreachable / CORS-blocked)
      // looks identical to a real wrong-password rejection unless these
      // are told apart — "Invalid email or password" on a dead backend
      // sends people down the wrong troubleshooting path entirely.
      if (!err?.response) {
        toast.error("Can't reach the server. It may be down — try again in a moment.")
      } else {
        toast.error(err.response.data?.error ?? 'Invalid email or password')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-900 p-12 lg:flex lg:w-[45%]">
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <div className="absolute left-0 top-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-white" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">AIRTEC</span>
        </div>

        <div className="relative space-y-8">
          <div>
            <h2 className="mb-4 text-4xl font-bold leading-tight text-white">
              School management,
              <br />
              finally done right.
            </h2>
            <p className="text-lg leading-relaxed text-indigo-200">
              SIS · Admission CRM · Fee Management · Examinations — all in one platform.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
                <p className="text-2xl font-bold text-white">{s.num}</p>
                <p className="mt-0.5 text-xs text-indigo-200">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-indigo-200">
          New to AIRTEC?{' '}
          <Link href="/auth/register" className="font-semibold text-white hover:underline">
            Register your school →
          </Link>
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow-indigo">
              <GraduationCap className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">AIRTEC</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your school dashboard</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@school.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" disabled={isLoading} className="mt-2 w-full" size="lg">
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href="/auth/register" className="font-semibold text-primary hover:underline">
              Register your school →
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
