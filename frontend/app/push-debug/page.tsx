'use client'

import { useCallback, useEffect, useState } from 'react'
import { oneSignalInfo } from '@/lib/median'
import { API_BASE } from '@/lib/api'

// ── Push diagnostics ────────────────────────────────────────────────
//
// Deliberately outside the authenticated shell and deliberately not
// routed through the push hook: this exists because three rounds of
// inferring the device's state from the server side were wrong, and the
// only way to stop guessing is to read what the bridge actually says.
//
// It shows the RAW bridge payload next to what median.ts makes of it, so
// a disagreement between the two is visible rather than something to
// deduce. Safe to leave in place — it reads state and reports it, and
// the only button that changes anything is the one that asks the OS for
// notification permission.
//
// The server half matters just as much. A device can register perfectly,
// report a healthy bridge, and still never receive anything because the
// transport it needs is unconfigured on the server — which is exactly
// what happened for two days, and which nothing on this page could see
// while it only read the bridge. `providers` and `everReached` below are
// the two values that answer it.
//
// Fetched with plain fetch, not the shared api client: that client hard-
// logs-out on a 401, and a diagnostics page must never bounce the person
// reading it to the login screen.

type Row = { label: string; value: any }

export default function PushDebug() {
  const [rows, setRows] = useState<Row[]>([])
  const [raw, setRaw] = useState<string>('(not read yet)')
  const [normalised, setNormalised] = useState<string>('(not read yet)')
  const [server, setServer] = useState<any>(null)
  const [serverText, setServerText] = useState<string>('(not read yet)')
  const [log, setLog] = useState<string[]>([])

  const say = (m: string) => setLog(l => [...l, `${new Date().toISOString().slice(11, 19)}  ${m}`])

  const bridge = () => (typeof window === 'undefined' ? null : ((window as any).median ?? (window as any).gonative))

  const probe = useCallback(async () => {
    const w = window as any
    const b = bridge()
    setRows([
      { label: 'window.median', value: !!w.median },
      { label: 'window.gonative', value: !!w.gonative },
      { label: 'bridge.onesignal', value: !!b?.onesignal },
      { label: 'onesignal.onesignalInfo', value: typeof b?.onesignal?.onesignalInfo },
      { label: 'onesignal.info', value: typeof b?.onesignal?.info },
      { label: 'onesignal.register', value: typeof b?.onesignal?.register },
      { label: 'onesignal.login', value: typeof b?.onesignal?.login },
      { label: 'onesignal.externalUserId', value: typeof b?.onesignal?.externalUserId },
      { label: 'onesignal.userPrivacyConsent', value: typeof b?.onesignal?.userPrivacyConsent },
      { label: 'enableForegroundNotifications', value: typeof b?.onesignal?.enableForegroundNotifications },
      { label: 'Notification.permission', value: typeof Notification !== 'undefined' ? Notification.permission : 'no Notification API' },
      { label: 'userAgent', value: navigator.userAgent },
    ])

    // Raw, straight from the bridge — no normalisation in the way.
    try {
      const r = await b?.onesignal?.onesignalInfo?.()
      setRaw(JSON.stringify(r, null, 2) ?? 'undefined')
    } catch (e: any) {
      setRaw('threw: ' + (e?.message ?? String(e)))
    }
    try {
      setNormalised(JSON.stringify(await oneSignalInfo(), null, 2) ?? 'null')
    } catch (e: any) {
      setNormalised('threw: ' + (e?.message ?? String(e)))
    }

    // What the SERVER believes about this account's devices.
    try {
      const token = localStorage.getItem('airtec_token')
      const res = await fetch(`${API_BASE}/notifications/push/subscriptions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setServer(null)
        setServerText(`HTTP ${res.status}: ${body?.error ?? 'request failed'}`
          + (res.status === 401 ? ' — sign in first, then re-read.' : ''))
      } else {
        setServer(body?.data ?? null)
        setServerText(JSON.stringify(body?.data, null, 2) ?? 'null')
      }
    } catch (e: any) {
      setServer(null)
      setServerText('threw: ' + (e?.message ?? String(e)))
    }
  }, [])

  useEffect(() => {
    // The bridge lands a beat after first paint.
    const t = setTimeout(probe, 1200)
    return () => clearTimeout(t)
  }, [probe])

  const act = async (name: string, fn: () => any) => {
    say(`${name} …`)
    try { const r = await fn(); say(`${name} -> ${JSON.stringify(r) ?? 'ok'}`) }
    catch (e: any) { say(`${name} THREW ${e?.message ?? String(e)}`) }
    await probe()
  }

  const all = `--- flags ---\n${rows.map(r => `${r.label}: ${r.value}`).join('\n')}\n\n--- raw oneSignalInfo ---\n${raw}\n\n--- normalised ---\n${normalised}\n\n--- server ---\n${serverText}\n\n--- log ---\n${log.join('\n')}`

  return (
    <div style={{ padding: 16, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Push diagnostics</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Btn onClick={probe}>Re-read</Btn>
        <Btn onClick={() => act('register', () => bridge()?.onesignal?.register?.())}>register()</Btn>
        <Btn onClick={() => act('consent.grant', () => bridge()?.onesignal?.userPrivacyConsent?.grant?.())}>grant consent</Btn>
        <Btn onClick={() => act('foreground(true)', () => bridge()?.onesignal?.enableForegroundNotifications?.(true))}>foreground on</Btn>
        <Btn onClick={() => navigator.clipboard?.writeText(all).then(() => say('copied'), () => say('copy failed'))}>Copy all</Btn>
      </div>

      <Section title="Bridge">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {rows.map(r => (
              <tr key={r.label}>
                <td style={{ padding: '2px 8px 2px 0', verticalAlign: 'top', opacity: 0.7, whiteSpace: 'nowrap' }}>{r.label}</td>
                <td style={{ padding: '2px 0', wordBreak: 'break-all', fontWeight: 600 }}>{String(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Server — can this account actually be reached?">
        {server ? (
          <>
            <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 8 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '2px 8px 2px 0', opacity: 0.7, whiteSpace: 'nowrap' }}>transports configured</td>
                  <td style={{ padding: '2px 0', fontWeight: 600 }}>
                    web push: <Verdict ok={!!server.providers?.webpush} />
                    {'   '}onesignal: <Verdict ok={!!server.providers?.onesignal} />
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '2px 8px 2px 0', opacity: 0.7, whiteSpace: 'nowrap' }}>devices the server knows</td>
                  <td style={{ padding: '2px 0', fontWeight: 600 }}>{server.active ?? 0}</td>
                </tr>
              </tbody>
            </table>
            {(server.devices ?? []).map((d: any) => (
              <div key={d.id} style={{ marginBottom: 6, paddingLeft: 8, borderLeft: '2px solid #d4d4d8' }}>
                <div style={{ fontWeight: 700 }}>{d.provider}</div>
                <div>reachable: <Verdict ok={!!d.reachable} /></div>
                {/* The single comparison that exposed a phone silently
                    receiving nothing while every delivery said "sent". */}
                <div>ever delivered to: <Verdict ok={!!d.everReached} /></div>
                <div style={{ opacity: 0.7 }}>last used {String(d.last_used_at)}</div>
                <div style={{ opacity: 0.7, wordBreak: 'break-all' }}>{String(d.user_agent).slice(0, 90)}</div>
              </div>
            ))}
            {(server.unreachable ?? []).length > 0 && (
              <Pre>{`${server.unreachable.length} registered device(s) can never be reached: `
                + `${server.unreachable.map((u: any) => u.provider).join(', ')} `
                + `is not configured on this server. Push will report "sent" if any OTHER `
                + `device succeeds, so trust this line over a delivery status.`}</Pre>
            )}
            {(server.devices ?? []).some((d: any) => d.reachable && !d.everReached) && (
              <Pre>{'A device is reachable but has never been delivered to. If that persists '
                + 'after a test push, the send is failing silently rather than being skipped.'}</Pre>
            )}
          </>
        ) : (
          <Pre>{serverText}</Pre>
        )}
      </Section>

      <Section title="Server — raw"><Pre>{serverText}</Pre></Section>

      <Section title="Raw oneSignalInfo() — what the app actually reports"><Pre>{raw}</Pre></Section>
      <Section title="Normalised by median.ts"><Pre>{normalised}</Pre></Section>
      <Section title="Action log"><Pre>{log.join('\n') || '(nothing yet)'}</Pre></Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

function Verdict({ ok }: { ok: boolean }) {
  return <span style={{ color: ok ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{ok ? 'yes' : 'NO'}</span>
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre style={{
      margin: 0, padding: 8, background: '#f4f4f5', color: '#111',
      border: '1px solid #d4d4d8', borderRadius: 6,
      whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto',
    }}>{children}</pre>
  )
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 12px', border: '1px solid #52525b', borderRadius: 8,
      background: '#fff', color: '#111', fontSize: 12, fontWeight: 600,
    }}>{children}</button>
  )
}
