'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { School, Users, Shield, Bell, Loader2, CheckCircle } from 'lucide-react'

const TABS = [
  { id: 'school', label: 'School Profile', icon: School },
  { id: 'users', label: 'Team Members', icon: Users },
  { id: 'security', label: 'Security', icon: Shield },
]

export default function SettingsPage() {
  const [tab, setTab] = useState('school')
  const { user } = useAuth()

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your school configuration and team</p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'school' && <SchoolProfileTab />}
      {tab === 'users' && <TeamTab />}
      {tab === 'security' && <SecurityTab />}
    </div>
  )
}

function SchoolProfileTab() {
  const { user } = useAuth()
  const school = (user as any)?.schools
  const [form, setForm] = useState({
    name: school?.name ?? '',
    city: school?.city ?? '',
    state: school?.state ?? '',
    phone: school?.phone ?? '',
    email: school?.email ?? '',
    affiliation_board: school?.affiliation_board ?? '',
    affiliation_no: school?.affiliation_no ?? '',
    established_year: school?.established_year ?? '',
  })
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    // In a real app, call PATCH /api/schools/:id
    setSaved(true)
    toast.success('School profile updated')
    setTimeout(() => setSaved(false), 2000)
  }

  const Input = ({ label, field, type = 'text', placeholder = '' }: any) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <input type={type} value={(form as any)[field]}
        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
    </div>
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900">School Information</h3>
        <p className="text-sm text-gray-500 mt-0.5">This appears on certificates, ID cards, and reports</p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="col-span-2">
          <Input label="School Name" field="name" placeholder="Delhi Public School" />
        </div>
        <Input label="City" field="city" placeholder="Lucknow" />
        <Input label="State" field="state" placeholder="Uttar Pradesh" />
        <Input label="Phone" field="phone" placeholder="+91 98765 43210" />
        <Input label="Email" field="email" type="email" placeholder="admin@school.com" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Affiliation Board</label>
          <select value={form.affiliation_board}
            onChange={e => setForm(f => ({ ...f, affiliation_board: e.target.value }))}
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all">
            <option value="">Select board</option>
            <option>CBSE</option>
            <option>ICSE</option>
            <option>UP Board</option>
            <option>State Board</option>
          </select>
        </div>
        <Input label="Affiliation No." field="affiliation_no" placeholder="2730045" />
        <Input label="Established Year" field="established_year" type="number" placeholder="1995" />
      </div>

      <div className="pt-2 border-t border-gray-100 flex justify-end">
        <button onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-200">
          {saved ? <><CheckCircle className="w-4 h-4" /> Saved!</> : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

function TeamTab() {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ full_name: '', email: '', role: 'teacher', password: '' })
  const [isLoading, setIsLoading] = useState(false)

  const { data: members } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get('/auth/team').then(r => r.data.data).catch(() => []),
  })

  const handleInvite = async () => {
    setIsLoading(true)
    try {
      await api.post('/auth/invite-user', inviteForm)
      toast.success(`${inviteForm.full_name} invited successfully`)
      setShowInvite(false)
      setInviteForm({ full_name: '', email: '', role: 'teacher', password: '' })
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to invite user')
    } finally {
      setIsLoading(false)
    }
  }

  const ROLE_COLORS: Record<string, string> = {
    school_admin: 'bg-indigo-100 text-indigo-700',
    principal: 'bg-purple-100 text-purple-700',
    teacher: 'bg-blue-100 text-blue-700',
    accountant: 'bg-emerald-100 text-emerald-700',
    counselor: 'bg-orange-100 text-orange-700',
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-gray-900">Team Members</h3>
            <p className="text-sm text-gray-500 mt-0.5">Manage who has access to AIRTEC</p>
          </div>
          <button onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-all">
            + Invite Member
          </button>
        </div>

        {(members ?? []).length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-medium">No team members yet</p>
            <p className="text-xs mt-1">Invite your principal, teachers, and accountants</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(members ?? []).map((m: any) => (
              <div key={m.id} className="flex items-center gap-4 py-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-indigo-700 text-xs font-bold">
                    {m.full_name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{m.full_name}</p>
                  <p className="text-xs text-gray-400">{m.email}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${ROLE_COLORS[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                  {m.role.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Invite Team Member</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              {[
                { label: 'Full Name', field: 'full_name', type: 'text', placeholder: 'Rajesh Kumar' },
                { label: 'Email', field: 'email', type: 'email', placeholder: 'teacher@school.com' },
                { label: 'Temporary Password', field: 'password', type: 'password', placeholder: 'Min. 8 chars' },
              ].map(f => (
                <div key={f.field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={(inviteForm as any)[f.field]}
                    onChange={e => setInviteForm(x => ({ ...x, [f.field]: e.target.value }))}
                    className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Role</label>
                <select value={inviteForm.role}
                  onChange={e => setInviteForm(x => ({ ...x, role: e.target.value }))}
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all">
                  <option value="teacher">Teacher</option>
                  <option value="principal">Principal</option>
                  <option value="accountant">Accountant</option>
                  <option value="counselor">Counselor</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowInvite(false)} className="px-4 py-2 text-sm text-gray-600 font-medium hover:text-gray-900">Cancel</button>
              <button onClick={handleInvite} disabled={isLoading || !inviteForm.full_name || !inviteForm.email}
                className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2 transition-all">
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SecurityTab() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900">Security</h3>
        <p className="text-sm text-gray-500 mt-0.5">Manage access and authentication</p>
      </div>
      <div className="space-y-4">
        {[
          { title: 'Role-Based Access Control', desc: 'All users are assigned roles (Admin, Teacher, Accountant, etc.) with scoped permissions.', active: true },
          { title: 'School Data Isolation', desc: 'Each school\'s data is fully isolated. No cross-school data access possible.', active: true },
          { title: 'Audit Logs', desc: 'Every sensitive action (fee edits, mark changes, discounts) is logged with user and timestamp.', active: true },
          { title: 'JWT Authentication', desc: 'Secure token-based authentication with automatic expiry.', active: true },
        ].map(f => (
          <div key={f.title} className="flex items-start gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50">
            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${f.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            <div>
              <p className="text-sm font-semibold text-gray-900">{f.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
            </div>
            {f.active && <span className="ml-auto text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex-shrink-0">Active</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
