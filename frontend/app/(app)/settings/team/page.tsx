'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { teamApi, rbacApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { UserPlus, Key, X, Loader2, Copy, Check, ShieldCheck, ShieldAlert, Power, Shield, Plus } from 'lucide-react'
import { toast } from 'sonner'

const ROLE_LABELS: Record<string, string> = {
  school_admin: 'School Admin',
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  counselor: 'Counselor',
}

const ROLE_COLORS: Record<string, string> = {
  school_admin: 'bg-indigo-100 text-indigo-700',
  principal: 'bg-purple-100 text-purple-700',
  teacher: 'bg-blue-100 text-blue-700',
  accountant: 'bg-emerald-100 text-emerald-700',
  counselor: 'bg-orange-100 text-orange-700',
}

export default function TeamPage() {
  const qc = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [resetTarget, setResetTarget] = useState<any>(null)
  const [rolesTarget, setRolesTarget] = useState<any>(null)

  const { data: team, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => teamApi.list().then(r => r.data),
  })

  const { data: extraRoles, error: extraRolesError } = useQuery({
    queryKey: ['team-extra-roles'],
    queryFn: () => teamApi.extraRoles().then(r => r.data),
  })
  console.log('DEBUG extraRoles:', extraRoles, 'ERROR:', extraRolesError)

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => teamApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      toast.success('Staff member deactivated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: any) => teamApi.update(id, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      toast.success('Role updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Settings</p>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage staff accounts, roles and login access</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
          <UserPlus className="w-4 h-4" /> Invite Team Member
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Login Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Joined</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(team ?? []).map((u: any) => (
                <tr key={u.id} className="hover:bg-gray-50/80">
                  <td className="px-5 py-3 font-semibold text-gray-900">
                    {u.full_name}
                    {!u.is_active && <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-xs">Inactive</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-500">{u.email}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <select value={u.role} onChange={e => roleMutation.mutate({ id: u.id, role: e.target.value })}
                        className={cn('px-2 py-1 rounded-lg text-xs font-semibold border-0 cursor-pointer', ROLE_COLORS[u.role])}>
                        {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      {(extraRoles?.[u.id] ?? []).map((roleName: string) => (
                        <span key={roleName}
                          className="px-2 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 whitespace-nowrap">
                          + {roleName}
                        </span>
                      ))}
                      <button onClick={() => setRolesTarget(u)} title="Manage additional roles"
                        className="p-1 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {u.has_login ? (
                      <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium"><ShieldCheck className="w-3.5 h-3.5" /> Active Login</span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600 text-xs font-medium"><ShieldAlert className="w-3.5 h-3.5" /> No Login</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{formatDate(u.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setResetTarget(u)} title={u.has_login ? 'Reset password' : 'Create login'}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                        <Key className="w-4 h-4" />
                      </button>
                      {u.is_active && (
                        <button onClick={() => { if (confirm(`Deactivate ${u.full_name}?`)) deactivateMutation.mutate(u.id) }}
                          title="Deactivate"
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Power className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && (
        <InviteModal onClose={() => { setShowInvite(false); qc.invalidateQueries({ queryKey: ['team'] }) }} />
      )}

      {resetTarget && (
        <ResetLoginModal user={resetTarget} onClose={() => { setResetTarget(null); qc.invalidateQueries({ queryKey: ['team'] }) }} />
      )}

      {rolesTarget && (
        <RoleManagerModal user={rolesTarget} extraRoles={extraRoles?.[rolesTarget.id] ?? []} onClose={() => {
          setRolesTarget(null)
          qc.invalidateQueries({ queryKey: ['team-extra-roles'] })
        }} />
      )}
    </div>
  )
}

function RoleManagerModal({ user, extraRoles, onClose }: { user: any, extraRoles: string[], onClose: () => void }) {
  const qc = useQueryClient()

  const { data: allRoles, isLoading } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacApi.roles.list().then(r => r.data),
  })

  const assignMutation = useMutation({
    mutationFn: (roleId: string) => teamApi.assignRole(user.id, roleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-extra-roles'] })
      toast.success('Role assigned')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const removeMutation = useMutation({
    mutationFn: (roleId: string) => teamApi.removeRole(user.id, roleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-extra-roles'] })
      toast.success('Role removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const primaryRoleName = ROLE_LABELS[user.role]

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-400" /> Manage Roles — {user.full_name}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-gray-500">
            Grant additional roles for workflow approvals (e.g. Exam Controller, Class Teacher) without changing their primary role.
          </p>
          {isLoading ? (
            <div className="h-32 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {(allRoles ?? []).map((r: any) => {
                const isPrimary = r.name === primaryRoleName
                const isAssigned = isPrimary || extraRoles.includes(r.name)
                return (
                  <div key={r.id} className={cn('flex items-center justify-between px-3 py-2.5 rounded-xl border',
                    isAssigned ? 'border-indigo-200 bg-indigo-50' : 'border-gray-100')}>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{r.name}</p>
                      {isPrimary && <p className="text-xs text-indigo-500">Primary role</p>}
                    </div>
                    {isPrimary ? (
                      <span className="text-xs text-gray-400">Locked</span>
                    ) : isAssigned ? (
                      <button onClick={() => removeMutation.mutate(r.id)} disabled={removeMutation.isPending}
                        className="text-xs text-red-600 font-semibold hover:text-red-700 disabled:opacity-50">
                        Remove
                      </button>
                    ) : (
                      <button onClick={() => assignMutation.mutate(r.id)} disabled={assignMutation.isPending}
                        className="text-xs text-indigo-600 font-semibold hover:text-indigo-700 disabled:opacity-50">
                        Assign
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Done</button>
        </div>
      </div>
    </div>
  )
}

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function CredentialsBox({ email, password }: { email: string, password: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-emerald-800 mb-2">Account created! Share these credentials:</p>
      <div className="bg-white rounded-lg p-3 font-mono text-sm space-y-1">
        <p><span className="text-gray-400">Email:</span> {email}</p>
        <p><span className="text-gray-400">Password:</span> {password}</p>
      </div>
      <button onClick={copy} className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 font-semibold hover:text-emerald-800">
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied!' : 'Copy credentials'}
      </button>
      <p className="text-xs text-emerald-600 mt-2">This password won't be shown again — make sure to share it now.</p>
    </div>
  )
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ full_name: '', email: '', role: 'teacher', phone: '', password: generatePassword(), designation: '', department: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ email: string, password: string } | null>(null)
  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  const handleSave = async () => {
    if (!form.full_name || !form.email || !form.password) return toast.error('Name, email and password required')
    setLoading(true)
    try {
      await teamApi.invite(form)
      setResult({ email: form.email, password: form.password })
      toast.success('Team member added')
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Invite Team Member</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {result ? (
          <div className="px-6 py-5 space-y-4">
            <CredentialsBox email={result.email} password={result.password} />
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
                <input className={ic} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="e.g. Priya Sharma" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email *</label>
                <input type="email" className={ic} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="priya@school.edu" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Role *</label>
                <select className={ic} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
                <input className={ic} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="9876543210" />
              </div>
              {form.role !== 'school_admin' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Designation</label>
                    <input className={ic} value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. PGT Mathematics" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Department</label>
                    <input className={ic} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Academics" />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Temporary Password *</label>
                <div className="flex gap-2">
                  <input className={ic + ' font-mono'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                  <button onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}
                    className="px-3 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 whitespace-nowrap">
                    Regenerate
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Share this with the staff member — they can log in immediately.</p>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          {result ? (
            <button onClick={onClose} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Done</button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
              <button onClick={handleSave} disabled={loading} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />} Create Account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ResetLoginModal({ user, onClose }: { user: any, onClose: () => void }) {
  const [password, setPassword] = useState(generatePassword())
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ email: string, password: string } | null>(null)
  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  const handleSave = async () => {
    if (password.length < 6) return toast.error('Password must be at least 6 characters')
    setLoading(true)
    try {
      await teamApi.resetLogin(user.id, password)
      setResult({ email: user.email, password })
      toast.success(user.has_login ? 'Password reset' : 'Login created')
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{user.has_login ? 'Reset Password' : 'Create Login'} — {user.full_name}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {result ? (
            <CredentialsBox email={result.email} password={result.password} />
          ) : (
            <>
              <p className="text-sm text-gray-500">
                {user.has_login
                  ? `This will set a new password for ${user.email}. Their old password will stop working.`
                  : `${user.email} doesn't have a login yet. This will create one so they can sign in.`}
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                <div className="flex gap-2">
                  <input className={ic + ' font-mono'} value={password} onChange={e => setPassword(e.target.value)} />
                  <button onClick={() => setPassword(generatePassword())} className="px-3 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 whitespace-nowrap">
                    Regenerate
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          {result ? (
            <button onClick={onClose} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Done</button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
              <button onClick={handleSave} disabled={loading} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />} {user.has_login ? 'Reset Password' : 'Create Login'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

