'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { certificateApi, studentsApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Plus, Award, FileText, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
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
  DialogFooter,
} from '@/components/ui/dialog'

const CERT_TYPES = [
  { value: 'character',     label: 'Character Certificate' },
  { value: 'bonafide',      label: 'Bonafide Certificate' },
  { value: 'migration',     label: 'Migration Certificate' },
  { value: 'achievement',   label: 'Achievement Certificate' },
  { value: 'participation', label: 'Participation Certificate' },
  { value: 'sports',        label: 'Sports Certificate' },
  { value: 'custom',        label: 'Custom Certificate' },
]

const DEFAULT_CONTENT: Record<string, string> = {
  character: `This is to certify that <strong>{{student_name}}</strong>, S/D/O {{father_name}}, is a bonafide student of Class <strong>{{class}}</strong> at {{school_name}}, {{city}}. {{gender_pronoun}} bears Admission No. <strong>{{admission_no}}</strong>.\n\nThis is to further certify that {{gender_his_her}} character and conduct have been <strong>good</strong> during {{gender_his_her}} stay at this institution. {{gender_pronoun}} is known to us as a sincere and hardworking student.\n\nThis certificate is issued on {{gender_his_her}} request for submission wherever required.`,

  bonafide: `This is to certify that <strong>{{student_name}}</strong> is a bonafide student of this institution. {{gender_pronoun}} is currently studying in Class <strong>{{class}}</strong> during the academic year.\n\nAdmission No: <strong>{{admission_no}}</strong>\nRoll No: <strong>{{roll_number}}</strong>\n\nThis certificate is issued on request for the purpose of {{extra_note}}.`,

  migration: `This is to certify that <strong>{{student_name}}</strong>, bearing Admission No. <strong>{{admission_no}}</strong>, was a student of <strong>{{school_name}}</strong>, {{city}} and has successfully completed Class <strong>{{class}}</strong>.\n\n{{gender_pronoun}} is hereby granted permission to migrate to any other recognized institution for further studies.\n\nThis certificate is issued on {{date}}.`,

  achievement: `This is to certify that <strong>{{student_name}}</strong> of Class <strong>{{class}}</strong> has achieved excellence and demonstrated outstanding performance.\n\n{{extra_note}}\n\nWe commend {{gender_his_her}} dedication and wish {{gender_pronoun}} continued success in all future endeavors.`,

  participation: `This is to certify that <strong>{{student_name}}</strong> of Class <strong>{{class}}</strong> has actively participated in the event/activity organized by {{school_name}}.\n\n{{extra_note}}\n\nWe appreciate {{gender_his_her}} enthusiasm and participation.`,

  sports: `This is to certify that <strong>{{student_name}}</strong> of Class <strong>{{class}}</strong> has represented {{school_name}} in sports activities and has shown exceptional performance.\n\n{{extra_note}}\n\nWe wish {{gender_pronoun}} all the best for future sporting endeavors.`,

  custom: `This is to certify that <strong>{{student_name}}</strong> of Class <strong>{{class}}</strong> at {{school_name}}.\n\n{{extra_note}}\n\nIssued on {{date}}.`,
}

export default function CertificatesPage() {
  const [tab, setTab]           = useState<'issue' | 'templates' | 'issued'>('issue')
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [showIssue, setShowIssue]             = useState(false)
  const qc = useQueryClient()

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['cert-templates'],
    queryFn: () => certificateApi.getTemplates().then(r => r.data),
  })

  const { data: issued, isLoading: issuedLoading } = useQuery({
    queryKey: ['issued-certs'],
    queryFn: () => certificateApi.getIssued().then(r => r.data),
    enabled: tab === 'issued',
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificates"
        description="Issue and manage student certificates"
        icon={Award}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowNewTemplate(true)}>
              <FileText className="h-4 w-4" /> New Template
            </Button>
            <Button onClick={() => setShowIssue(true)}>
              <Plus className="h-4 w-4" /> Issue Certificate
            </Button>
          </>
        }
      />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="issue">Issue Certificate</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="issued">Issued History</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Issue Certificate tab */}
      {tab === 'issue' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {CERT_TYPES.map(ct => {
            const tmpl = (templates ?? []).find((t: any) => t.certificate_type === ct.value)
            return (
              <Card key={ct.value}
                className="cursor-pointer transition-all hover:border-primary/40 hover:shadow-md"
                onClick={() => setShowIssue(true)}>
                <CardContent className="p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    <Award className="h-6 w-6 text-primary" />
                  </div>
                  <p className="font-semibold text-foreground">{ct.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tmpl ? 'Custom template ready' : 'Default template'}
                  </p>
                  <Button
                    variant="secondary"
                    className="mt-4 w-full bg-primary/10 text-primary hover:bg-primary/20"
                    onClick={e => { e.stopPropagation(); setShowIssue(true) }}>
                    Issue →
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Templates tab */}
      {tab === 'templates' && (
        <Card>
          {templatesLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : !(templates ?? []).length ? (
            <EmptyState
              icon={FileText}
              title="No custom templates yet"
              description="Default wording is used for every certificate type until you create your own. Add a template to control the exact text."
              action={<Button onClick={() => setShowNewTemplate(true)}><FileText className="h-4 w-4" /> Create First Template</Button>}
            />
          ) : (
            <div className="divide-y divide-border">
              {(templates ?? []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-semibold text-foreground">{t.name}</p>
                    <p className="mt-0.5 text-xs capitalize text-primary">{t.certificate_type.replace('_', ' ')} Certificate</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Created {formatDate(t.created_at)}</p>
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Issued history tab */}
      {tab === 'issued' && (
        <Card className="overflow-hidden">
          {issuedLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !(issued ?? []).length ? (
            <EmptyState
              icon={Award}
              title="No certificates issued yet"
              description="Every certificate you issue is logged here with its number, so you can reprint it later."
              action={<Button onClick={() => setShowIssue(true)}><Plus className="h-4 w-4" /> Issue Certificate</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Cert No.</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Issued On</TableHead>
                  <TableHead>Issued By</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(issued ?? []).map((c: any) => (
                  <TableRow key={c.id} className="cursor-default">
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.certificate_number}</TableCell>
                    <TableCell className="font-medium text-foreground">
                      {c.students?.first_name} {c.students?.last_name}
                      <span className="ml-2 text-xs text-muted-foreground">{c.students?.classes?.name}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-primary/10 capitalize text-primary">
                        {c.certificate_type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.users?.full_name}</TableCell>
                    <TableCell>
                      <Button asChild variant="link" size="sm" className="h-auto p-0">
                        <a href={certificateApi.print(c.certificate_number)} target="_blank" rel="noreferrer">
                          <Printer className="h-3 w-3" /> Print
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {showNewTemplate && (
        <NewTemplateModal onClose={() => { setShowNewTemplate(false); qc.invalidateQueries({ queryKey: ['cert-templates'] }) }} />
      )}
      {showIssue && (
        <IssueCertificateModal
          templates={templates ?? []}
          onClose={() => { setShowIssue(false); qc.invalidateQueries({ queryKey: ['issued-certs'] }) }}
        />
      )}
    </div>
  )
}

function NewTemplateModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: '', certificate_type: 'character', content: DEFAULT_CONTENT.character })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!form.name || !form.content) return toast.error('Name and content required')
    setLoading(true)
    try {
      await certificateApi.createTemplate(form)
      toast.success('Template created!')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Certificate Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tmpl-name">Template Name *</Label>
              <Input id="tmpl-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Standard Character Certificate" />
            </div>
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={form.certificate_type}
                onValueChange={v => setForm(f => ({ ...f, certificate_type: v, content: DEFAULT_CONTENT[v] ?? '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CERT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-content">
              Content *
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Use: {`{{student_name}} {{class}} {{admission_no}} {{date}} {{school_name}} {{father_name}} {{extra_note}}`}
              </span>
            </Label>
            <Textarea id="tmpl-content" rows={10} value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              className="resize-none font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IssueCertificateModal({ templates, onClose }: { templates: any[], onClose: () => void }) {
  const [form, setForm] = useState({
    student_id: '', certificate_type: 'character',
    extra_data: { father_name: '', extra_note: '' }
  })
  const [loading, setLoading] = useState(false)

  const { data: students } = useQuery({
    queryKey: ['students-list'],
    queryFn: () => studentsApi.list({ limit: 200 }).then(r => r.data),
  })

  const matchingTemplate = templates.find(t => t.certificate_type === form.certificate_type)

  const handleIssue = async () => {
    if (!form.student_id) return toast.error('Please select a student')
    setLoading(true)
    try {
      const templateId = matchingTemplate?.id
      if (!templateId) {
        // Create a default template on the fly
        const newTemplate = await certificateApi.createTemplate({
          name: `Default ${form.certificate_type} Template`,
          certificate_type: form.certificate_type,
          content: DEFAULT_CONTENT[form.certificate_type] ?? DEFAULT_CONTENT.custom,
        })
        const cert = await certificateApi.issue({
          student_id: form.student_id,
          template_id: newTemplate.data.id,
          extra_data: form.extra_data,
        })
        toast.success(`Certificate issued! No: ${cert.data.certificate_number}`)
        window.open(certificateApi.print(cert.data.certificate_number), '_blank')
      } else {
        const cert = await certificateApi.issue({
          student_id: form.student_id,
          template_id: templateId,
          extra_data: form.extra_data,
        })
        toast.success(`Certificate issued! No: ${cert.data.certificate_number}`)
        window.open(certificateApi.print(cert.data.certificate_number), '_blank')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to issue certificate')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue Certificate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Student *</Label>
            <Select value={form.student_id || undefined}
              onValueChange={v => setForm(f => ({ ...f, student_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select student..." /></SelectTrigger>
              <SelectContent>
                {(students ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.first_name} {s.last_name} — {s.classes?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Certificate Type *</Label>
            <Select value={form.certificate_type}
              onValueChange={v => setForm(f => ({ ...f, certificate_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CERT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {matchingTemplate && (
              <p className="text-xs text-success">✓ Using custom template: {matchingTemplate.name}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-father">Father&apos;s Name</Label>
            <Input id="cert-father" value={form.extra_data.father_name}
              onChange={e => setForm(f => ({ ...f, extra_data: { ...f.extra_data, father_name: e.target.value } }))}
              placeholder="For character/bonafide certificates" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-note">Additional Note</Label>
            <Textarea id="cert-note" rows={2} value={form.extra_data.extra_note}
              onChange={e => setForm(f => ({ ...f, extra_data: { ...f.extra_data, extra_note: e.target.value } }))}
              placeholder="e.g. purpose of certificate, achievement details..."
              className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleIssue} disabled={loading || !form.student_id}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Issuing...</> : '🎓 Issue & Print'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
