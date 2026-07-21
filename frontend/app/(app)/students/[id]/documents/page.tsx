'use client'
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { studentsApi } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import { ArrowLeft, Upload, FileText, Trash2, Eye, Download, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const DOC_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar Card' },
  { value: 'birth_certificate', label: 'Birth Certificate' },
  { value: 'transfer_certificate', label: 'Transfer Certificate' },
  { value: 'marksheet', label: 'Marksheet' },
  { value: 'medical', label: 'Medical Record' },
  { value: 'address_proof', label: 'Address Proof' },
  { value: 'photo_id', label: 'Photo ID' },
  { value: 'other', label: 'Other' },
]

const DOC_ICONS: Record<string, string> = {
  aadhaar: '🪪',
  birth_certificate: '📄',
  transfer_certificate: '📋',
  marksheet: '📊',
  medical: '🏥',
  address_proof: '🏠',
  photo_id: '🪪',
  other: '📎',
}

export default function StudentDocumentsPage() {
  const { id } = useParams<{ id: string }>()
  const [showUpload, setShowUpload] = useState(false)
  const qc = useQueryClient()

  const { data: student } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id).then(r => r.data),
  })

  const { data: docs, isLoading } = useQuery({
    queryKey: ['student-docs', id],
    queryFn: () => studentsApi.getDocuments(id).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => studentsApi.deleteDocument(id, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-docs', id] })
      toast.success('Document deleted')
    },
  })

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/students/${id}`} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Documents — {student?.first_name} {student?.last_name}
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {(docs ?? []).length} document{(docs ?? []).length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
        </div>
        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
          <Plus className="w-4 h-4" /> Upload Document
        </button>
      </div>

      {/* Documents list */}
      <div className="bg-white rounded-2xl border border-gray-200">
        {isLoading ? (
          <div className="p-12 text-center text-gray-400">Loading documents...</div>
        ) : !(docs ?? []).length ? (
          <div className="p-20 text-center text-gray-400">
            <FileText className="w-14 h-14 mx-auto mb-4 text-gray-200" />
            <p className="font-medium text-base">No documents uploaded yet</p>
            <p className="text-sm mt-1.5">Upload Aadhaar, birth certificate, marksheets and more</p>
            <button onClick={() => setShowUpload(true)}
              className="mt-5 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700">
              Upload First Document
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(docs ?? []).map((doc: any) => (
              <div key={doc.id} className="flex items-center gap-5 px-8 py-5 hover:bg-gray-50 transition-colors">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl leading-none">{DOC_ICONS[doc.document_type] ?? '📎'}</span>
                </div>

                <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_auto] gap-6 items-center">
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="font-semibold text-gray-900 text-base">{doc.document_name}</p>
                      <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full whitespace-nowrap">
                        {DOC_TYPES.find(t => t.value === doc.document_type)?.label ?? doc.document_type}
                      </span>
                    </div>
                    {doc.notes && (
                      <p className="text-sm text-gray-500 mt-1.5 italic">"{doc.notes}"</p>
                    )}
                  </div>

                  <div className="text-right text-sm text-gray-400 whitespace-nowrap hidden sm:block">
                    <p>{formatDate(doc.created_at)}</p>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5 text-xs">
                      {doc.file_size && <span>{doc.file_size}</span>}
                      {doc.file_size && doc.users?.full_name && <span className="text-gray-300">·</span>}
                      {doc.users?.full_name && <span>{doc.users.full_name}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a href={doc.file_url} target="_blank" rel="noreferrer" title="View"
                      className="p-2.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                      <Eye className="w-4.5 h-4.5" />
                    </a>
                    <a href={doc.file_url} download title="Download"
                      className="p-2.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                      <Download className="w-4.5 h-4.5" />
                    </a>
                    <button
                      onClick={() => {
                        if (confirm('Delete this document?')) deleteMutation.mutate(doc.id)
                      }}
                      title="Delete"
                      className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showUpload && (
        <UploadModal studentId={id} onClose={() => {
          setShowUpload(false)
          qc.invalidateQueries({ queryKey: ['student-docs', id] })
        }} />
      )}
    </div>
  )
}

function UploadModal({ studentId, onClose }: { studentId: string, onClose: () => void }) {
  const [form, setForm] = useState({ document_type: 'aadhaar', document_name: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async () => {
    if (!file) return toast.error('Please select a file')
    if (!form.document_name) return toast.error('Please enter a document name')
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          await studentsApi.uploadDocument(studentId, {
            file_base64: reader.result,
            file_name: file.name,
            mime_type: file.type,
            ...form,
          })
          toast.success('Document uploaded!')
          onClose()
        } catch (e: any) {
          toast.error(e?.response?.data?.error ?? 'Upload failed')
        } finally {
          setUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Upload Document</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Document Type</label>
            <select value={form.document_type}
              onChange={e => setForm(f => ({ ...f, document_type: e.target.value }))}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Document Name *</label>
            <input value={form.document_name}
              onChange={e => setForm(f => ({ ...f, document_name: e.target.value }))}
              placeholder="e.g. Aadhaar Card - Front & Back"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">File *</label>
            <div
              onClick={() => fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                file ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
              )}>
              {file ? (
                <div>
                  <p className="text-sm font-medium text-indigo-700">{file.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Click to select file</p>
                  <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG up to 10MB</p>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <input value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes..."
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium hover:text-gray-900">Cancel</button>
          <button onClick={handleUpload} disabled={uploading || !file}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}