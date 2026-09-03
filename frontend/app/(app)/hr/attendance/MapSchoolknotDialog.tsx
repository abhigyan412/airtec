'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Save, Wand2, Link2, Link2Off } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from '@/components/ui/select'
import { hrmsApi } from '@/lib/api'

// ── SchoolKnot mapper ───────────────────────────────────────────────
//
// The admin maps each staff member to their biometric device here. The map
// is stored in a standalone schoolknot_staff_mapping table (shared across
// admins), read back on open and saved on Save. Reads fall back to the code
// default when the table has no rows yet.

type Mapping = Record<string, { school: string; reg: string }>

// SchoolKnot school codes are opaque; show the school's name in the UI.
const SCHOOL_LABELS: Record<string, string> = { SC3102: 'RBPIC', SC3104: 'Trinity' }
const schoolLabel = (sk: string) => SCHOOL_LABELS[sk] ?? sk

const norm = (s: string) => (s ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
function nameScore(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter(t => t.length > 1))
  const B = new Set(norm(b).split(' ').filter(t => t.length > 1))
  if (!A.size || !B.size) return 0
  const [S, L] = A.size <= B.size ? [A, B] : [B, A]
  let hit = 0; for (const t of S) if (L.has(t)) hit++
  return hit / S.size
}

const NON_TEACHING = new Set(['school_admin']) // service accounts we still list but don't auto-map

export function MapSchoolknotDialog({ open, onOpenChange, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved?: () => void
}) {
  const staffQ = useQuery({
    queryKey: ['hr-staff-for-map'],
    queryFn: () => hrmsApi.staff.list({ limit: 300 }).then(r => r.data),
    enabled: open,
  })
  const rosterQ = useQuery({
    queryKey: ['schoolknot-roster'],
    queryFn: () => hrmsApi.attendance.schoolknotRoster().then((r: any) => r.data),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  })
  const mappingQ = useQuery({
    queryKey: ['schoolknot-mapping'],
    queryFn: () => hrmsApi.attendance.schoolknotMapping().then((r: any) => r.data),
    enabled: open,
  })
  const qc = useQueryClient()

  const staff: any[] = staffQ.data ?? []
  const roster: { school: string; reg: string; name: string; punchedToday: boolean }[] = rosterQ.data?.roster ?? []
  const schools: string[] = rosterQ.data?.schools ?? []

  const [map, setMap] = useState<Mapping>({})
  const [q, setQ] = useState('')

  // Seed the editor from the stored mapping (table, or the code default when
  // the table is empty) each time it's loaded.
  useEffect(() => {
    if (open && mappingQ.data?.mapping) setMap(mappingQ.data.mapping)
  }, [open, mappingQ.data])

  const saveMut = useMutation({
    mutationFn: () => hrmsApi.attendance.saveSchoolknotMapping(map),
    onSuccess: () => {
      toast.success(`Saved — ${Object.keys(map).length} staff mapped.`)
      qc.invalidateQueries({ queryKey: ['schoolknot-mapping'] })
      qc.invalidateQueries({ queryKey: ['schoolknot-sync-status'] })
      onSaved?.()
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not save the mapping'),
  })

  const rosterByKey = useMemo(() => {
    const m = new Map<string, typeof roster[number]>()
    for (const r of roster) m.set(`${r.school}:${r.reg}`, r)
    return m
  }, [roster])

  const rosterBySchool = useMemo(() => {
    const g = new Map<string, typeof roster>()
    for (const r of roster) { if (!g.has(r.school)) g.set(r.school, []); g.get(r.school)!.push(r) }
    for (const list of g.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return g
  }, [roster])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = staff.filter(s => !needle || s.full_name.toLowerCase().includes(needle) || s.email.toLowerCase().includes(needle))
    return list.sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [staff, q])

  const set = (email: string, key: string) =>
    setMap(m => {
      const next = { ...m }
      if (key === 'none') delete next[email]
      else { const [school, reg] = key.split(':'); next[email] = { school, reg } }
      return next
    })

  // Fill only the currently-UNMAPPED staff with a best-guess device, so the
  // admin's own choices are never overwritten — they just review the guesses.
  const autoSuggest = () => {
    setMap(m => {
      const next = { ...m }
      const taken = new Set(Object.values(next).map(v => `${v.school}:${v.reg}`))
      for (const s of staff) {
        if (next[s.email] || NON_TEACHING.has(s.role)) continue
        let best: { key: string; score: number } | null = null
        for (const r of roster) {
          const key = `${r.school}:${r.reg}`
          if (taken.has(key)) continue
          const score = nameScore(s.full_name, r.name)
          if (score >= 0.5 && (!best || score > best.score)) best = { key, score }
        }
        if (best) { const [school, reg] = best.key.split(':'); next[s.email] = { school, reg }; taken.add(best.key) }
      }
      return next
    })
    toast.info('Suggested devices for unmapped staff — review, then Save.')
  }

  const loading = staffQ.isLoading || rosterQ.isLoading || mappingQ.isLoading
  const mappedCount = Object.keys(map).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Map staff to SchoolKnot devices</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Pick each person's biometric device. Shared with everyone at this school.
            {schools.length > 0 && <> Schools: {schools.map(schoolLabel).join(', ')}.</>}
          </p>
        </DialogHeader>

        {rosterQ.error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Could not load the SchoolKnot roster. {(rosterQ.error as any)?.response?.data?.error ?? ''}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input placeholder="Search staff…" value={q} onChange={e => setQ(e.target.value)} className="h-9" />
              <Button variant="outline" size="sm" onClick={autoSuggest} disabled={loading} title="Fill unmapped staff with a best-guess device">
                <Wand2 className="h-4 w-4" /> Auto-suggest
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading staff and the live roster…
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visible.map(s => {
                    const cur = map[s.email]
                    const curKey = cur ? `${cur.school}:${cur.reg}` : 'none'
                    const hit = cur ? rosterByKey.get(curKey) : undefined
                    return (
                      <div key={s.email} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{s.full_name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{s.email}</p>
                        </div>
                        {cur && !hit && (
                          <span className="text-[11px] text-warning-foreground" title="This device is not in the current roster">reg not in feed</span>
                        )}
                        <Select value={curKey} onValueChange={v => set(s.email, v)}>
                          <SelectTrigger className="h-8 w-[230px] text-xs">
                            <SelectValue>
                              {cur ? `${schoolLabel(cur.school)} · ${cur.reg}${hit ? ` · ${hit.name}` : ''}` : <span className="text-muted-foreground">Not on a device</span>}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none"><span className="flex items-center gap-1.5"><Link2Off className="h-3 w-3" /> Not on a device</span></SelectItem>
                            {schools.map(sk => (
                              <SelectGroup key={sk}>
                                <SelectLabel>{schoolLabel(sk)}</SelectLabel>
                                {(rosterBySchool.get(sk) ?? []).map(r => (
                                  <SelectItem key={`${sk}:${r.reg}`} value={`${sk}:${r.reg}`}>
                                    {r.reg} · {r.name || '—'}{r.punchedToday ? ' ●' : ''}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{mappedCount} mapped</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={loading || saveMut.isPending}>
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save mapping
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
