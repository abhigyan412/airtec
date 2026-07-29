'use client'
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { studentsApi } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import { ArrowLeft, Upload, FileText, Trash2, Eye, Download, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

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

  const studentName = [student?.first_name, student?.last_name].filter(Boolean).join(' ')

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to student" className="mt-1 shrink-0">
          <Link href={`/students/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title={studentName ? `Documents — ${studentName}` : 'Documents'}
          description={`${(docs ?? []).length} document${(docs ?? []).length !== 1 ? 's' : ''} uploaded`}
          icon={FileText}
          actions={
            <Button onClick={() => setShowUpload(true)}>
              <Plus className="h-4 w-4" /> Upload Document
            </Button>
          }
        />
      </div>

      {/* Documents list */}
      <Card className="rounded-2xl">
        {isLoading ? (
          <div className="space-y-4 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-2xl" />
            ))}
          </div>
        ) : !(docs ?? []).length ? (
          <EmptyState
            icon={FileText}
            title="No documents uploaded yet"
            description="Upload Aadhaar, birth certificate, marksheets and more"
            action={<Button onClick={() => setShowUpload(true)}>Upload First Document</Button>}
          />
        ) : (
          <div className="divide-y divide-border">
            {(docs ?? []).map((doc: any) => (
              <div key={doc.id} className="flex items-center gap-5 px-8 py-5 hover:bg-muted/50 transition-colors">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl leading-none">{DOC_ICONS[doc.document_type] ?? '📎'}</span>
                </div>

                <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_auto] gap-6 items-center">
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="font-semibold text-foreground text-base">{doc.document_name}</p>
                      <Badge className="border-transparent bg-primary/10 text-primary whitespace-nowrap">
                        {DOC_TYPES.find(t => t.value === doc.document_type)?.label ?? doc.document_type}
                      </Badge>
                    </div>
                    {doc.notes && (
                      <p className="text-sm text-muted-foreground mt-1.5 italic">"{doc.notes}"</p>
                    )}
                  </div>

                  <div className="text-right text-sm text-muted-foreground whitespace-nowrap hidden sm:block">
                    <p>{formatDate(doc.created_at)}</p>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5 text-xs">
                      {doc.file_size && <span>{doc.file_size}</span>}
                      {doc.file_size && doc.users?.full_name && <span className="text-muted-foreground/50">·</span>}
                      {doc.users?.full_name && <span>{doc.users.full_name}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-primary" title="View">
                      <a href={doc.file_url} target="_blank" rel="noreferrer" aria-label="View document">
                        <Eye className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-success" title="Download">
                      <a href={doc.file_url} download aria-label="Download document">
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete"
                      aria-label="Delete document"
                      onClick={() => {
                        if (confirm('Delete this document?')) deleteMutation.mutate(doc.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={form.document_type} onValueChange={v => setForm(f => ({ ...f, document_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-name">Document Name *</Label>
            <Input id="doc-name" value={form.document_name}
              onChange={e => setForm(f => ({ ...f, document_name: e.target.value }))}
              placeholder="e.g. Aadhaar Card - Front & Back" />
          </div>
          <div className="space-y-1.5">
            <Label>File *</Label>
            <div
              onClick={() => fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                file ? 'border-primary bg-primary/10' : 'border-input hover:border-primary hover:bg-muted/50'
              )}>
              {file ? (
                <div>
                  <p className="text-sm font-medium text-primary">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Click to select file</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">PDF, JPG, PNG up to 10MB</p>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-notes">Notes (optional)</Label>
            <Input id="doc-notes" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpload} disabled={uploading || !file}>
            {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</> : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
