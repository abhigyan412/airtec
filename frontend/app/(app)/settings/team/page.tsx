'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { teamApi, rbacApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { UserPlus, Key, Loader2, Copy, Check, ShieldCheck, ShieldAlert, Power, Shield, Plus, Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

const ROLE_LABELS: Record<string, string> = {
  school_admin: 'School Admin',
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  counselor: 'Counselor',
}

const ROLE_COLORS: Record<string, string> = {
  school_admin: 'bg-primary/10 text-primary',
  principal: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  teacher: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  accountant: 'bg-success/10 text-success',
  counselor: 'bg-warning/10 text-warning',
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
      <PageHeader
        title="Team Members"
        description="Manage staff accounts, roles and login access"
        icon={SettingsIcon}
        className="mb-0"
        actions={
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="h-4 w-4" /> Invite Team Member
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (team ?? []).length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No team members yet"
            description="Invite your principal, teachers and accountants — each one gets a login and a role that scopes what they can see."
            action={
              <Button onClick={() => setShowInvite(true)}>
                <UserPlus className="h-4 w-4" /> Invite Team Member
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Login Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(team ?? []).map((u: any) => (
                  <TableRow key={u.id} className="cursor-default">
                    <TableCell className="font-semibold text-foreground">
                      {u.full_name}
                      {!u.is_active && <Badge variant="secondary" className="ml-2">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Select value={u.role} onValueChange={role => roleMutation.mutate({ id: u.id, role })}>
                          <SelectTrigger
                            className={cn(
                              'h-7 w-auto gap-1 border-0 px-2 text-xs font-semibold shadow-none',
                              ROLE_COLORS[u.role],
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ROLE_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(extraRoles?.[u.id] ?? []).map((roleName: string) => (
                          <span
                            key={roleName}
                            className="whitespace-nowrap rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground"
                          >
                            + {roleName}
                          </span>
                        ))}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={() => setRolesTarget(u)}
                          title="Manage additional roles"
                          aria-label="Manage additional roles"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.has_login ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-success"><ShieldCheck className="h-3.5 w-3.5" /> Active Login</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-medium text-warning"><ShieldAlert className="h-3.5 w-3.5" /> No Login</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          onClick={() => setResetTarget(u)}
                          title={u.has_login ? 'Reset password' : 'Create login'}
                          aria-label={u.has_login ? 'Reset password' : 'Create login'}
                        >
                          <Key className="h-4 w-4" />
                        </Button>
                        {u.is_active && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => { if (confirm(`Deactivate ${u.full_name}?`)) deactivateMutation.mutate(u.id) }}
                            title="Deactivate"
                            aria-label="Deactivate"
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

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
  const [departmentScope, setDepartmentScope] = useState('')

  const { data: allRoles, isLoading } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacApi.roles.list().then(r => r.data),
  })

  const assignMutation = useMutation({
    mutationFn: (roleId: string) => teamApi.assignRole(user.id, roleId, departmentScope || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-extra-roles'] })
      toast.success(departmentScope ? `Role assigned, restricted to ${departmentScope}` : 'Role assigned')
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
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" /> Manage Roles — {user.full_name}
          </DialogTitle>
          <DialogDescription>
            Grant additional roles for workflow approvals (e.g. Exam Controller, Class Teacher) without changing their primary role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Restrict next assignment to a department (optional)</Label>
          <Input value={departmentScope} onChange={e => setDepartmentScope(e.target.value)}
            placeholder="e.g. Academics — leave blank for school-wide" />
          <p className="text-xs text-muted-foreground">Only meaningful for roles carrying Staff View/Edit — applies to whichever role you click "Assign" for below.</p>
        </div>
        {isLoading ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {(allRoles ?? []).map((r: any) => {
              const isPrimary = r.name === primaryRoleName
              const isAssigned = isPrimary || extraRoles.includes(r.name)
              return (
                <div key={r.id} className={cn('flex items-center justify-between rounded-xl border px-3 py-2.5',
                  isAssigned ? 'border-primary/30 bg-primary/5' : 'border-border')}>
                  <div>
                    <p className="text-sm font-medium text-foreground">{r.name}</p>
                    {isPrimary && <p className="text-xs text-primary">Primary role</p>}
                  </div>
                  {isPrimary ? (
                    <span className="text-xs text-muted-foreground">Locked</span>
                  ) : isAssigned ? (
                    <button onClick={() => removeMutation.mutate(r.id)} disabled={removeMutation.isPending}
                      className="rounded text-xs font-semibold text-destructive hover:text-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50">
                      Remove
                    </button>
                  ) : (
                    <button onClick={() => assignMutation.mutate(r.id)} disabled={assignMutation.isPending}
                      className="rounded text-xs font-semibold text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50">
                      Assign
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <div className="rounded-xl border border-success/20 bg-success/10 p-4">
      <p className="mb-2 text-sm font-semibold text-success">Account created! Share these credentials:</p>
      <div className="space-y-1 rounded-lg border border-border bg-card p-3 font-mono text-sm">
        <p><span className="text-muted-foreground">Email:</span> {email}</p>
        <p><span className="text-muted-foreground">Password:</span> {password}</p>
      </div>
      <button onClick={copy} className="mt-2 flex items-center gap-1.5 rounded text-xs font-semibold text-success hover:text-success/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied!' : 'Copy credentials'}
      </button>
      <p className="mt-2 text-xs text-success/80">This password won&apos;t be shown again — make sure to share it now.</p>
    </div>
  )
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ full_name: '', email: '', role: 'teacher', phone: '', password: generatePassword(), designation: '', department: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ email: string, password: string } | null>(null)

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
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>

        {result ? (
          <CredentialsBox email={result.email} password={result.password} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inv-name">Full Name *</Label>
              <Input id="inv-name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="e.g. Priya Sharma" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inv-email">Email *</Label>
              <Input id="inv-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="priya@school.edu" />
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-phone">Phone</Label>
              <Input id="inv-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="9876543210" />
            </div>
            {form.role !== 'school_admin' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-desig">Designation</Label>
                  <Input id="inv-desig" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. PGT Mathematics" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-dept">Department</Label>
                  <Input id="inv-dept" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Academics" />
                </div>
              </>
            )}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inv-pass">Temporary Password *</Label>
              <div className="flex gap-2">
                <Input id="inv-pass" className="font-mono" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                <Button variant="outline" className="whitespace-nowrap" onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}>
                  Regenerate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Share this with the staff member — they can log in immediately.</p>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Create Account
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetLoginModal({ user, onClose }: { user: any, onClose: () => void }) {
  const [password, setPassword] = useState(generatePassword())
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ email: string, password: string } | null>(null)

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
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{user.has_login ? 'Reset Password' : 'Create Login'} — {user.full_name}</DialogTitle>
        </DialogHeader>
        {result ? (
          <CredentialsBox email={result.email} password={result.password} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {user.has_login
                ? `This will set a new password for ${user.email}. Their old password will stop working.`
                : `${user.email} doesn't have a login yet. This will create one so they can sign in.`}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reset-pass">New Password</Label>
              <div className="flex gap-2">
                <Input id="reset-pass" className="font-mono" value={password} onChange={e => setPassword(e.target.value)} />
                <Button variant="outline" className="whitespace-nowrap" onClick={() => setPassword(generatePassword())}>
                  Regenerate
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {user.has_login ? 'Reset Password' : 'Create Login'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
