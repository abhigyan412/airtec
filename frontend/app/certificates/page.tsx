'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { certificateApi, studentsApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Plus, Award, FileText, Eye, Loader2, X, Printer } from 'lucide-react'
import { toast } from 'sonner'

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

  const { data: templates } = useQuery({
    queryKey: ['cert-templates'],
    queryFn: () => certificateApi.getTemplates().then(r => r.data),
  })

  const { data: issued } = useQuery({
    queryKey: ['issued-certs'],
    queryFn: () => certificateApi.getIssued().then(r => r.data),
    enabled: tab === 'issued',
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Certificates</h1>
          <p className="text-gray-500 text-sm mt-0.5">Issue and manage student certificates</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowNewTemplate(true)}
            className="flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all">
            <FileText className="w-4 h-4" /> New Template
          </button>
          <button onClick={() => setShowIssue(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all">
            <Plus className="w-4 h-4" /> Issue Certificate
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { key: 'issue',     label: 'Issue Certificate' },
          { key: 'templates', label: 'Templates' },
          { key: 'issued',    label: 'Issued History' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Issue Certificate tab */}
      {tab === 'issue' && (
        <div className="grid grid-cols-3 gap-5">
          {CERT_TYPES.map(ct => {
            const tmpl = (templates ?? []).find((t: any) => t.certificate_type === ct.value)
            return (
              <div key={ct.value}
                className="bg-white rounded-2xl border border-gray-200 p-6 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => setShowIssue(true)}>
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                  <Award className="w-6 h-6 text-indigo-600" />
                </div>
                <p className="font-semibold text-gray-900">{ct.label}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {tmpl ? 'Custom template ready' : 'Default template'}
                </p>
                <button
                  onClick={e => { e.stopPropagation(); setShowIssue(true) }}
                  className="mt-4 w-full py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-semibold hover:bg-indigo-100 transition-colors">
                  Issue →
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Templates tab */}
      {tab === 'templates' && (
        <div className="bg-white rounded-2xl border border-gray-200">
          {!(templates ?? []).length ? (
            <div className="p-12 text-center text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-200" />
              <p className="font-medium">No custom templates yet</p>
              <p className="text-sm mt-1">Default templates are used when no custom template exists</p>
              <button onClick={() => setShowNewTemplate(true)}
                className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700">
                Create First Template
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(templates ?? []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-semibold text-gray-900">{t.name}</p>
                    <p className="text-xs text-indigo-600 mt-0.5 capitalize">{t.certificate_type.replace('_', ' ')} Certificate</p>
                    <p className="text-xs text-gray-400 mt-0.5">Created {formatDate(t.created_at)}</p>
                  </div>
                  <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">Active</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Issued history tab */}
      {tab === 'issued' && (
        <div className="bg-white rounded-2xl border border-gray-200">
          {!(issued ?? []).length ? (
            <div className="p-12 text-center text-gray-400">
              <Award className="w-12 h-12 mx-auto mb-3 text-gray-200" />
              <p className="font-medium">No certificates issued yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Cert No.</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Student</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Issued On</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Issued By</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(issued ?? []).map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{c.certificate_number}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {c.students?.first_name} {c.students?.last_name}
                      <span className="text-xs text-gray-400 ml-2">{c.students?.classes?.name}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium capitalize">
                        {c.certificate_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{formatDate(c.created_at)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{c.users?.full_name}</td>
                    <td className="px-5 py-3">
                      <a href={certificateApi.print(c.certificate_number)}
                        target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                        <Printer className="w-3 h-3" /> Print
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Create Certificate Template</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Template Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Standard Character Certificate"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Type *</label>
              <select value={form.certificate_type}
                onChange={e => setForm(f => ({ ...f, certificate_type: e.target.value, content: DEFAULT_CONTENT[e.target.value] ?? '' }))}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                {CERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Content *
              <span className="text-xs text-gray-400 font-normal ml-2">
                Use: {`{{student_name}} {{class}} {{admission_no}} {{date}} {{school_name}} {{father_name}} {{extra_note}}`}
              </span>
            </label>
            <textarea rows={10} value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none font-mono" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Template
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Issue Certificate</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Student *</label>
            <select value={form.student_id}
              onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Select student...</option>
              {(students ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.first_name} {s.last_name} — {s.classes?.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Certificate Type *</label>
            <select value={form.certificate_type}
              onChange={e => setForm(f => ({ ...f, certificate_type: e.target.value }))}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {CERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {matchingTemplate && (
              <p className="text-xs text-green-600 mt-1">✓ Using custom template: {matchingTemplate.name}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Father's Name</label>
            <input value={form.extra_data.father_name}
              onChange={e => setForm(f => ({ ...f, extra_data: { ...f.extra_data, father_name: e.target.value } }))}
              placeholder="For character/bonafide certificates"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Additional Note</label>
            <textarea rows={2} value={form.extra_data.extra_note}
              onChange={e => setForm(f => ({ ...f, extra_data: { ...f.extra_data, extra_note: e.target.value } }))}
              placeholder="e.g. purpose of certificate, achievement details..."
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleIssue} disabled={loading || !form.student_id}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Issuing...</> : '🎓 Issue & Print'}
          </button>
        </div>
      </div>
    </div>
  )
}