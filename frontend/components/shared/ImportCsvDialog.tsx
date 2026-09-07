'use client'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Upload, Download, AlertCircle } from 'lucide-react'
import { parseCsv, csvTemplate, downloadCsv } from '@/lib/csv'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export interface ImportResult { inserted: number; errors: { row: number; error: string }[] }

// One reusable "Import CSV" dialog for every Add-something screen in
// Transport (and anywhere else that wants it): pick a file, parse it
// client-side (no upload plumbing — the parsed rows go up as a plain
// JSON array), preview the row count, submit to a bulk-insert endpoint
// that validates and inserts what it can and reports the rest by row
// number, rather than an all-or-nothing failure that makes one typo in
// row 40 of 200 block the other 199.
export function ImportCsvDialog({ open, onOpenChange, title, columns, sampleRow, onImport, invalidateQueryKey }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Column headers the template/CSV should have, in order. */
  columns: string[]
  /** One example data row, same order as columns, shown under the template link. */
  sampleRow?: string[]
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>
  invalidateQueryKey: string[]
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const importMutation = useMutation({
    mutationFn: () => onImport(rows!),
    onSuccess: res => {
      setResult(res)
      qc.invalidateQueries({ queryKey: invalidateQueryKey })
      if (res.errors.length === 0) toast.success(`Imported ${res.inserted} row${res.inserted === 1 ? '' : 's'}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Import failed'),
  })

  const reset = () => { setRows(null); setFileName(''); setResult(null); if (fileRef.current) fileRef.current.value = '' }
  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v) }

  const handleFile = async (file: File) => {
    const text = await file.text()
    const parsed = parseCsv(text)
    setFileName(file.name)
    setRows(parsed)
    setResult(null)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Upload a CSV with these columns: {columns.join(', ')}.</DialogDescription>
        </DialogHeader>

        <button
          type="button"
          onClick={() => downloadCsv(`${title.toLowerCase().replace(/\s+/g, '-')}-template.csv`, csvTemplate(columns) + (sampleRow ? sampleRow.join(',') + '\r\n' : ''))}
          className="flex w-fit items-center gap-1.5 rounded-lg text-xs font-medium text-primary hover:underline"
        >
          <Download className="h-3.5 w-3.5" /> Download template
        </button>

        <div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Upload className="h-5 w-5" />
            {fileName ? fileName : 'Click to choose a CSV file'}
          </button>
        </div>

        {rows && (
          <p className="text-sm text-muted-foreground">{rows.length} row{rows.length === 1 ? '' : 's'} found.</p>
        )}

        {result && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{result.inserted} imported{result.errors.length > 0 ? `, ${result.errors.length} failed` : ''}.</p>
            {result.errors.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/5 p-2">
                {result.errors.map((e, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>Row {e.row}: {e.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>{result ? 'Close' : 'Cancel'}</Button>
          {!result && (
            <Button onClick={() => importMutation.mutate()} disabled={!rows?.length || importMutation.isPending}>
              {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import {rows?.length ?? 0} Row{rows?.length === 1 ? '' : 's'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
