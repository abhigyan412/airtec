'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GraduationCap, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { toast } from 'sonner'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setIsLoading(true)
    try {
      await login(email, password)
      toast.success('Welcome back!')
      router.push('/dashboard')
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Invalid email or password')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-[45%] bg-gradient-to-br from-indigo-900 via-indigo-800 to-violet-900 flex-col justify-between p-12 relative overflow-hidden">
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
              School management,<br />finally done right.
            </h2>
            <p className="text-indigo-200 text-lg leading-relaxed">
              SIS · Admission CRM · Fee Management · Examinations — all in one platform.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { num: '10K+', label: 'Students managed' },
              { num: '50+', label: 'Schools onboarded' },
              { num: '₹2Cr+', label: 'Fees processed' },
              { num: '99.9%', label: 'Uptime' },
            ].map(s => (
              <div key={s.label} className="bg-white/10 rounded-xl p-4">
                <p className="text-2xl font-bold text-white">{s.num}</p>
                <p className="text-indigo-300 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-indigo-300 text-xs">
          New to AIRTEC?{' '}
          <Link href="/auth/register" className="text-white font-semibold hover:underline">Register your school →</Link>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl text-gray-900">AIRTEC</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-gray-500 text-sm mt-1">Sign in to your school dashboard</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@school.com"
                  required
                  className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full px-4 py-3 pr-11 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm shadow-indigo-200 mt-2"
              >
                {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : 'Sign in'}
              </button>
            </form>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don't have an account?{' '}
            <Link href="/auth/register" className="text-indigo-600 font-semibold hover:underline">
              Register your school →
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
