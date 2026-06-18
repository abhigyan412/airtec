'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GraduationCap, ArrowRight, Loader2, CheckCircle, ArrowLeft } from 'lucide-react'
import { authApi } from '@/lib/api'
import { toast } from 'sonner'
import Link from 'next/link'

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="w-9 h-9 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">School registered!</h2>
          <p className="text-gray-500 text-sm mb-6">
            <span className="font-medium text-gray-700">{form.school_name}</span> is ready.<br />
            Your admin account has been created.
          </p>
          <div className="bg-gray-50 rounded-xl p-4 text-left mb-6 space-y-2">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Login credentials</p>
            <p className="text-sm text-gray-700"><span className="text-gray-400">Email:</span> {form.email}</p>
            <p className="text-sm text-gray-700"><span className="text-gray-400">Password:</span> {'•'.repeat(form.password.length)}</p>
          </div>
          <button
            onClick={() => router.push('/auth/login')}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
          >
            Go to Login <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      {/* Left */}
      <div className="hidden lg:flex lg:w-[45%] bg-gradient-to-br from-indigo-900 via-indigo-800 to-violet-900 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-white rounded-full translate-x-1/3 translate-y-1/3" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <span className="text-white font-bold text-xl tracking-tight">AIRTEC</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Set up your school<br />in 2 minutes
          </h2>
          <p className="text-indigo-200 text-lg leading-relaxed mb-10">
            Everything is ready the moment you register — classes, houses, fee heads, and your admin account.
          </p>
          <div className="space-y-4">
            {['Classes 1–12 auto-created', '4 houses pre-configured', 'Default fee heads ready', 'Full admin access instantly'].map(f => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-indigo-400/30 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-3.5 h-3.5 text-indigo-200" />
                </div>
                <span className="text-indigo-100 text-sm">{f}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-indigo-300 text-xs">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-white font-semibold hover:underline">Sign in →</Link>
        </div>
      </div>

      {/* Right */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-lg">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {STEPS.slice(0, 2).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  i < step ? 'bg-indigo-600 text-white' :
                  i === step ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' :
                  'bg-gray-200 text-gray-400'
                }`}>
                  {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-sm font-medium ${i === step ? 'text-gray-900' : 'text-gray-400'}`}>{s}</span>
                {i < 1 && <div className={`w-8 h-0.5 mx-1 ${i < step ? 'bg-indigo-600' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">School information</h1>
                  <p className="text-gray-500 text-sm mt-1">Tell us about your school</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">School name *</label>
                  <input value={form.school_name} onChange={e => set('school_name', e.target.value)}
                    placeholder="e.g. Delhi Public School"
                    className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">City</label>
                    <input value={form.school_city} onChange={e => set('school_city', e.target.value)}
                      placeholder="Lucknow"
                      className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">State</label>
                    <input value={form.school_state} onChange={e => set('school_state', e.target.value)}
                      placeholder="Uttar Pradesh"
                      className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
                    <input value={form.school_phone} onChange={e => set('school_phone', e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Board</label>
                    <select value={form.affiliation_board} onChange={e => set('affiliation_board', e.target.value)}
                      className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all">
                      <option value="">Select board</option>
                      <option>CBSE</option>
                      <option>ICSE</option>
                      <option>UP Board</option>
                      <option>State Board</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => setStep(1)}
                  disabled={!form.school_name}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 mt-2"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <button onClick={() => setStep(0)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>
                  <h1 className="text-xl font-bold text-gray-900">Admin account</h1>
                  <p className="text-gray-500 text-sm mt-1">This will be your login</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Your full name *</label>
                  <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
                    placeholder="e.g. Rajesh Kumar"
                    className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address *</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    placeholder="admin@yourschool.com"
                    className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Password *</label>
                    <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                      placeholder="Min. 8 characters"
                      className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm *</label>
                    <input type="password" value={form.confirm_password} onChange={e => set('confirm_password', e.target.value)}
                      placeholder="Repeat password"
                      className={`w-full px-4 py-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all ${
                        form.confirm_password && form.confirm_password !== form.password ? 'border-red-300' : 'border-gray-200'
                      }`} />
                  </div>
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={isLoading || !form.full_name || !form.email || !form.password || form.password !== form.confirm_password}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 mt-2 shadow-sm shadow-indigo-200"
                >
                  {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering...</> : <>Register school <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            )}
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-indigo-600 font-semibold hover:underline">Sign in →</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
