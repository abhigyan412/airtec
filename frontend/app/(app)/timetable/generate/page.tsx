'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Download, Eye, History, Loader2, RotateCcw, Trash2, Wand2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

import { timetableApi, timetableError, prettyDate } from '@/lib/timetableApi'
import { Banner, Chip, TableSkeleton } from '../components'
import { DraftPreview } from './DraftPreview'

// ═══════════════════════════════════════════════════════════════
// Building a timetable, and swapping it in.
// ═══════════════════════════════════════════════════════════════
//
// Two things this screen is careful about, both learned from what goes
// wrong with timetable software:
//
//   • It refuses BEFORE it runs. If Maths needs 96 periods a week and
//     the Maths teachers can supply 80, that is arithmetic, and saying
//     so takes a second — whereas a generator that grinds for two
//     minutes and then reports "no solution found" has wasted an
//     afternoon and taught the user nothing.
//
//   • Nothing it produces goes live on its own. Generation makes a
//     DRAFT. Somebody with publish rights looks at it and swaps it in,
//     and the timetable it replaced is kept so a bad swap is one click
//     to undo rather than a support ticket.

export default function GeneratePage() {
  const qc = useQueryClient()
  const { can, isLoading: permsLoading } = usePermissions()
  const [keepLocked, setKeepLocked] = useState(true)
  const [label, setLabel] = useState('')
  const [lastRun, setLastRun] = useState<any>(null)
  const [confirming, setConfirming] = useState<{ kind: 'publish' | 'rollback' | 'discard'; version: any } | null>(null)
  const [previewing, setPreviewing] = useState<{ id: string; label: string } | null>(null)
  const [feasibilityDetailsOpen, setFeasibilityDetailsOpen] = useState(false)

  const canPublish = can('timetable.publish')
  const canExport = can('timetable.export')

  const exportVersion = useMutation({
    mutationFn: (v: { id: string; label: string }) =>
      timetableApi.exportVersion(v.id, `timetable-${(v.label || 'export').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') || 'export'}.xlsx`),
    onError: (e) => toast.error(timetableError(e)),
  })

  const feasibility = useQuery({
    queryKey: ['tt-feasibility'],
    queryFn: () => timetableApi.feasibility(),
    enabled: !permsLoading && can('timetable.generate'),
    retry: false,
  })

  const versions = useQuery({
    queryKey: ['tt-versions'],
    queryFn: () => timetableApi.versions(),
  })

  const generate = useMutation({
    mutationFn: () => timetableApi.generate({ keepLocked, label: label || undefined }),
    onSuccess: (data) => {
      setLastRun(data)
      toast.success(`Draft ready — ${data.rowsWritten} periods placed`)
      qc.invalidateQueries({ queryKey: ['tt-versions'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const publish = useMutation({
    mutationFn: (id: string) => timetableApi.publish(id),
    onSuccess: (r: any) => {
      toast.success(`Published — ${r.published} periods live, ${r.teachersNotified} teachers told`)
      setConfirming(null)
      setLastRun(null)
      qc.invalidateQueries({ queryKey: ['tt-versions'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const rollback = useMutation({
    mutationFn: (id: string) => timetableApi.rollback(id),
    onSuccess: (r: any) => {
      toast.success(`Rolled back — ${r.restored} periods restored`)
      setConfirming(null)
      qc.invalidateQueries({ queryKey: ['tt-versions'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const discard = useMutation({
    mutationFn: (id: string) => timetableApi.discardDraft(id),
    onSuccess: () => {
      toast.success('Draft discarded')
      setConfirming(null)
      setLastRun(null)
      qc.invalidateQueries({ queryKey: ['tt-versions'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (permsLoading) return <div className="p-6"><TableSkeleton /></div>

  if (!can('timetable.generate')) {
    return (
      <div className="p-6">
        <EmptyState icon={AlertTriangle} title="You don't have access to timetable generation" />
      </div>
    )
  }

  const feasible = feasibility.data?.feasible

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Generate a timetable"
        description="Build a draft from the weekly plan, then publish it when you're happy."
        icon={Wand2}
        centered
      />

      <Tabs defaultValue="build">
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="versions">
            History
            {(versions.data ?? []).some((v: any) => v.status === 'draft') && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                draft
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="build">
          <div className="max-w-3xl space-y-5">
            {/* Can this even work. */}
            {feasibility.isLoading ? (
              <TableSkeleton rows={3} cols={1} />
            ) : feasibility.error ? (
              <Banner tone="bad" title="Cannot check yet">
                {timetableError(feasibility.error)}
              </Banner>
            ) : feasibility.data && (
              <Card className={cn(feasible ? 'border-success/40' : 'border-destructive/40')}>
                <CardContent className="p-4">
                  <div className="flex flex-col items-center text-center">
                    {feasible
                      ? <CheckCircle2 className="h-5 w-5 text-success" />
                      : <AlertTriangle className="h-5 w-5 text-destructive" />}
                    <p className="mt-1.5 text-sm font-semibold text-foreground">
                      {feasible ? 'The plan can be scheduled' : 'Needs attention'}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {feasible
                        ? 'Enough teacher time, enough room time, and every section adds up.'
                        : 'Fix these first — generating now would only fail slowly.'}
                    </p>

                    <button
                      type="button"
                      onClick={() => setFeasibilityDetailsOpen(v => !v)}
                      className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', feasibilityDetailsOpen && 'rotate-180')} />
                      {feasibilityDetailsOpen ? 'Hide details' : 'Show details'}
                    </button>
                  </div>

                  {feasibilityDetailsOpen && (
                    <div className="mt-3 space-y-3 text-left">
                      {feasibility.data.groups.map((group: any) => (
                        <div key={group.templateName}>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {group.templateName} · {group.sections} sections · {group.periodsPerDay} periods a day
                          </p>
                          {group.readable.length ? (
                            <ul className="mt-1 space-y-1">
                              {group.readable.map((message: string, i: number) => (
                                <li key={i} className="flex items-start gap-2 text-sm">
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                                  <span className="text-muted-foreground">{message}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-0.5 text-sm text-success">No problems found</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="space-y-4 p-4">
                <div>
                  <Label htmlFor="gen-label">Name this version (optional)</Label>
                  <Input
                    id="gen-label" value={label} onChange={e => setLabel(e.target.value)}
                    placeholder="e.g. 2026-27 session, first draft" className="mt-1.5"
                  />
                </div>
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox checked={keepLocked} onChange={e => setKeepLocked(e.target.checked)} className="mt-0.5" />
                  <span>
                    <span className="block text-sm text-foreground">Keep pinned cells where they are</span>
                    <span className="block text-xs text-muted-foreground">
                      Anything locked on the current timetable stays put and everything else is
                      built around it.
                    </span>
                  </span>
                </label>

                <div className="flex flex-col items-center gap-2">
                  <Button onClick={() => generate.mutate()} disabled={generate.isPending || feasible === false}>
                    {generate.isPending
                      ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      : <Wand2 className="mr-1.5 h-4 w-4" />}
                    Generate a draft
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    This creates a draft. Nothing changes for teachers until it is published.
                  </p>
                </div>
              </CardContent>
            </Card>

            {lastRun && (
              <RunResult
                run={lastRun}
                canPublish={canPublish}
                onPreview={() => setPreviewing({ id: lastRun.versionId, label: label || 'this draft' })}
                onPublish={() => setConfirming({ kind: 'publish', version: { id: lastRun.versionId, label: label || 'this draft' } })}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="versions">
          {versions.isLoading ? <TableSkeleton rows={4} cols={4} /> : !versions.data?.length ? (
            <EmptyState icon={History} title="No versions yet" />
          ) : (
            <div className="space-y-2">
              {versions.data.map((version: any) => (
                <Card key={version.id} className={cn(version.status === 'active' && 'border-success/40')}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{version.label}</p>
                        <Chip tone={version.status === 'active' ? 'good' : version.status === 'draft' ? 'info' : 'neutral'}>
                          {version.status}
                        </Chip>
                        <Chip>{version.source}</Chip>
                        {version.score != null && <Chip title="Lower is better">score {version.score}</Chip>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {version.created_by_name && `by ${version.created_by_name} · `}
                        {prettyDate(version.created_at.slice(0, 10))}
                        {version.draft_periods != null && ` · ${version.draft_periods} periods`}
                        {version.published_at && ` · published ${prettyDate(version.published_at.slice(0, 10))}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {/* Archived versions keep no periods (their rows are removed
                          when they're superseded), so there's nothing to export —
                          shown disabled with the reason rather than hidden. */}
                      {canExport && (
                        <Button size="sm" variant="outline"
                          onClick={() => exportVersion.mutate({ id: version.id, label: version.label })}
                          disabled={version.status === 'archived' || (exportVersion.isPending && exportVersion.variables?.id === version.id)}
                          title={version.status === 'archived'
                            ? 'Archived versions keep no periods to export. Export the live timetable or a draft.'
                            : 'Download as Excel, in the same format the import reads'}>
                          {exportVersion.isPending && exportVersion.variables?.id === version.id
                            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            : <Download className="mr-1.5 h-3.5 w-3.5" />}
                          Export
                        </Button>
                      )}
                      {version.status === 'draft' && (
                        <Button size="sm" variant="outline"
                          onClick={() => setPreviewing({ id: version.id, label: version.label })}>
                          <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview
                        </Button>
                      )}
                      {version.status === 'draft' && canPublish && (
                        <Button size="sm" onClick={() => setConfirming({ kind: 'publish', version })}>Publish</Button>
                      )}
                      {version.status === 'draft' && (
                        <Button size="sm" variant="ghost" onClick={() => setConfirming({ kind: 'discard', version })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {version.can_rollback && canPublish && version.status !== 'draft' && (
                        <Button size="sm" variant="outline" onClick={() => setConfirming({ kind: 'rollback', version })}>
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Undo this publish
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {previewing && (
        <DraftPreview
          versionId={previewing.id}
          label={previewing.label}
          open
          onOpenChange={open => !open && setPreviewing(null)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={open => !open && setConfirming(null)}
          title={
            confirming.kind === 'publish' ? `Publish "${confirming.version.label}"?`
              : confirming.kind === 'rollback' ? 'Undo this publish?'
              : 'Discard this draft?'
          }
          description={
            confirming.kind === 'publish'
              ? 'This replaces the live timetable for every section in the draft, and every affected teacher is told. If you have not looked at the draft yet, close this and press Preview first. The timetable it replaces is kept, so this can be undone.'
              : confirming.kind === 'rollback'
                ? 'The timetable that was in place before this version was published will be restored.'
                : 'The draft and everything in it will be deleted. The live timetable is not affected.'
          }
          confirmLabel={confirming.kind === 'publish' ? 'Publish' : confirming.kind === 'rollback' ? 'Undo' : 'Discard'}
          destructive={confirming.kind === 'discard'}
          loading={publish.isPending || rollback.isPending || discard.isPending}
          onConfirm={() => {
            if (confirming.kind === 'publish') publish.mutate(confirming.version.id)
            else if (confirming.kind === 'rollback') rollback.mutate(confirming.version.id)
            else discard.mutate(confirming.version.id)
          }}
        />
      )}
    </div>
  )
}

function RunResult({ run, canPublish, onPreview, onPublish }: { run: any; canPublish: boolean; onPreview: () => void; onPublish: () => void }) {
  const blocking = run.conflicts.flatMap((g: any) => g.conflicts.filter((c: any) => c.severity === 'block'))
  const warnings = run.conflicts.flatMap((g: any) => g.conflicts.filter((c: any) => c.severity === 'warn'))

  return (
    <Card className="border-primary/40">
      <CardContent className="p-4 text-center">
        <h3 className="text-sm font-semibold text-foreground">Draft ready</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {run.rowsWritten} periods placed. Lower scores mean fewer compromises on the soft rules
          — morning placement, spread across the week, teacher day balance.
        </p>

        <div className="mt-3 space-y-2">
          {run.groups.map((group: any) => (
            <div key={group.templateName} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium text-foreground">{group.templateName}</span>
              <Chip>{group.sections} sections</Chip>
              <Chip>{group.placed} periods</Chip>
              <Chip tone="info">score {group.score}</Chip>
              <Chip>{group.elapsedMs}ms</Chip>
              {group.blocking > 0 && <Chip tone="bad">{group.blocking} blocking</Chip>}
              {group.warnings > 0 && <Chip tone="warn">{group.warnings} warnings</Chip>}
            </div>
          ))}
        </div>

        {blocking.length > 0 && (
          <div className="mt-3">
            <Banner tone="bad" title={`${blocking.length} problem${blocking.length === 1 ? '' : 's'} in the draft`}>
              <ul className="mt-1 list-disc pl-4">
                {blocking.slice(0, 6).map((c: any, i: number) => <li key={i}>{c.message}</li>)}
              </ul>
            </Banner>
          </div>
        )}

        {warnings.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              {warnings.length} soft-rule warning{warnings.length === 1 ? '' : 's'}
            </summary>
            <ul className="mt-2 space-y-1">
              {warnings.slice(0, 20).map((c: any, i: number) => (
                <li key={i} className="text-sm text-muted-foreground">• {c.message}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onPreview}>
            <Eye className="mr-1.5 h-4 w-4" /> Look at it first
          </Button>
          {canPublish ? (
            <Button onClick={onPublish} disabled={blocking.length > 0}>Publish this draft</Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Saved as a draft. Somebody with publishing rights needs to put it live.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
