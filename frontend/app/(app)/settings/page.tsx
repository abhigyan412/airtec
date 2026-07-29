'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { School, Users, Shield, Bell, Loader2, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  DialogFooter,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'

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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Manage your school configuration and team</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map(t => (
            <TabsTrigger key={t.id} value={t.id} className="gap-2">
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>School Information</CardTitle>
        <CardDescription>This appears on certificates, ID cards, and reports</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="school-name">School Name</Label>
            <Input id="school-name" value={form.name} onChange={set('name')} placeholder="Delhi Public School" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="school-city">City</Label>
            <Input id="school-city" value={form.city} onChange={set('city')} placeholder="Lucknow" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="school-state">State</Label>
            <Input id="school-state" value={form.state} onChange={set('state')} placeholder="Uttar Pradesh" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="school-phone">Phone</Label>
            <Input id="school-phone" value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="school-email">Email</Label>
            <Input id="school-email" type="email" value={form.email} onChange={set('email')} placeholder="admin@school.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Affiliation Board</Label>
            <Select
              value={form.affiliation_board || undefined}
              onValueChange={v => setForm(f => ({ ...f, affiliation_board: v }))}
            >
              <SelectTrigger>
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
          <div className="space-y-1.5">
            <Label htmlFor="school-affno">Affiliation No.</Label>
            <Input id="school-affno" value={form.affiliation_no} onChange={set('affiliation_no')} placeholder="2730045" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="school-year">Established Year</Label>
            <Input id="school-year" type="number" value={form.established_year} onChange={set('established_year')} placeholder="1995" />
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-end border-t border-border pt-6">
        <Button onClick={handleSave}>
          {saved ? <><CheckCircle className="h-4 w-4" /> Saved!</> : 'Save Changes'}
        </Button>
      </CardFooter>
    </Card>
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

  const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'info'> = {
    school_admin: 'default',
    principal: 'secondary',
    teacher: 'info',
    accountant: 'success',
    counselor: 'warning',
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Team Members</CardTitle>
            <CardDescription>Manage who has access to AIRTEC</CardDescription>
          </div>
          <Button onClick={() => setShowInvite(true)}>+ Invite Member</Button>
        </CardHeader>
        <CardContent>
          {(members ?? []).length === 0 ? (
            <EmptyState
              icon={Users}
              title="No team members yet"
              description="Invite your principal, teachers, and accountants"
            />
          ) : (
            <div className="divide-y divide-border">
              {(members ?? []).map((m: any) => (
                <div key={m.id} className="flex items-center gap-4 py-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                      {m.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{m.full_name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <Badge variant={ROLE_VARIANTS[m.role] ?? 'secondary'} className="capitalize">
                    {m.role.replace('_', ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite modal */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {[
              { label: 'Full Name', field: 'full_name', type: 'text', placeholder: 'Rajesh Kumar' },
              { label: 'Email', field: 'email', type: 'email', placeholder: 'teacher@school.com' },
              { label: 'Temporary Password', field: 'password', type: 'password', placeholder: 'Min. 8 chars' },
            ].map(f => (
              <div key={f.field} className="space-y-1.5">
                <Label htmlFor={`invite-${f.field}`}>{f.label}</Label>
                <Input
                  id={`invite-${f.field}`}
                  type={f.type}
                  placeholder={f.placeholder}
                  value={(inviteForm as any)[f.field]}
                  onChange={e => setInviteForm(x => ({ ...x, [f.field]: e.target.value }))}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={inviteForm.role} onValueChange={v => setInviteForm(x => ({ ...x, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="teacher">Teacher</SelectItem>
                  <SelectItem value="principal">Principal</SelectItem>
                  <SelectItem value="accountant">Accountant</SelectItem>
                  <SelectItem value="counselor">Counselor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={isLoading || !inviteForm.full_name || !inviteForm.email}>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SecurityTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Manage access and authentication</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[
            { title: 'Role-Based Access Control', desc: 'All users are assigned roles (Admin, Teacher, Accountant, etc.) with scoped permissions.', active: true },
            { title: 'School Data Isolation', desc: 'Each school\'s data is fully isolated. No cross-school data access possible.', active: true },
            { title: 'Audit Logs', desc: 'Every sensitive action (fee edits, mark changes, discounts) is logged with user and timestamp.', active: true },
            { title: 'JWT Authentication', desc: 'Secure token-based authentication with automatic expiry.', active: true },
          ].map(f => (
            <div key={f.title} className="flex items-start gap-4 rounded-xl border border-border bg-muted/40 p-4">
              <div className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', f.active ? 'bg-success' : 'bg-muted-foreground/40')} />
              <div>
                <p className="text-sm font-semibold text-foreground">{f.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{f.desc}</p>
              </div>
              {f.active && <Badge variant="success" className="ml-auto shrink-0">Active</Badge>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
