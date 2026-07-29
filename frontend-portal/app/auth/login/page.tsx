'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GraduationCap, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const STAFF_ROLES = ['school_admin', 'principal', 'teacher', 'accountant', 'counselor', 'super_admin']
const STAFF_APP_URL = process.env.NEXT_PUBLIC_STAFF_APP_URL ?? 'http://localhost:3000'

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
      if (STAFF_ROLES.includes(user.role)) {
        // Wrong portal — this app is family-only. Don't leave them
        // signed in here with nowhere useful to go.
        toast.error('This portal is for parents and students. Staff should sign in at the admin app.')
        logout()
        return
      }
      toast.success('Welcome back!')
      router.push('/')
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
    <div className="flex min-h-dvh">
      {/* Left panel. This is branding, not chrome: it stays dark indigo in both
          themes on purpose, so the tokens below deliberately stop at its edge. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-800 to-violet-900 p-12 lg:flex lg:w-[45%]">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-white rounded-full translate-x-1/3 translate-y-1/3" />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-white" />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">AIRTEC</span>
        </div>
        <div className="relative space-y-6">
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight mb-4">
              Stay close to<br />their school day.
            </h2>
            <p className="text-indigo-200 text-lg leading-relaxed">
              Attendance, fees, homework, timetable, and exam results — all in one place.
            </p>
          </div>
        </div>
        <div className="relative text-indigo-300 text-xs">
          Staff member? Sign in at the{' '}
          <a href={STAFF_APP_URL} className="text-white font-semibold hover:underline">admin app →</a>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">AIRTEC</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to the family portal</p>
          </div>

          <Card className="p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="pr-12"
                  />
                  {/* Full 44px target, and the label names the action the tap
                      performs rather than the state it's in. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" size="lg" disabled={isLoading} className="mt-2 w-full">
                {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in...</> : 'Sign in'}
              </Button>
            </form>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Don't have login details? Contact your school office.
          </p>
        </div>
      </div>
    </div>
  )
}
