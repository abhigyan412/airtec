import { describe, it, expect, vi } from 'vitest'
import {
  createLead,
  isSpam,
  leadMessage,
  LeadInsertError,
  LeadRequestSchema,
  MIN_FILL_MS,
  pingLeadWebhook,
  toLeadRow,
  type LeadRow,
} from '../marketingLeads'

// Pure logic with the insert and fetch injected, so no database or network:
// the route in modules/public/routes.ts only wires these to supabase and
// process.env.LEADS_WEBHOOK_URL.

const NOW = new Date('2026-10-11T10:00:00+05:30')
const rendered = NOW.getTime() - 60_000 // a minute spent on the form

const full = {
  form: 'full',
  name: 'Meera Joshi',
  role: 'Principal',
  school_name: 'Greenfield Public School',
  city: 'Pune',
  state: 'Maharashtra',
  phone: '+91 98765 43210',
  email: 'meera@example.com',
  student_strength: '800–1500',
  board: 'CBSE',
  modules: ['fees', 'timetable'],
  message: 'We want to see cover arrangements.',
  consent: true,
  website: '',
  rendered_at: rendered,
  source_path: '/contact',
  utm: { utm_source: 'google' },
}
const short = {
  form: 'short',
  name: 'Kabir Shah',
  school_name: 'Sunrise School',
  phone: '9876543210',
  consent: true,
  rendered_at: rendered,
  source_path: '/',
}
const trial = {
  form: 'trial',
  name: 'Riya M.',
  role: 'Administrator',
  school_name: 'Lakeview Academy',
  city: 'Indore',
  phone: '09876543210',
  trial_module: 'exams',
  consent: true,
  rendered_at: rendered,
  source_path: '/free-trial',
}

const okFetch = () => vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
const deps = (over: Partial<Parameters<typeof createLead>[1]> = {}) => ({
  insert: vi.fn(async () => ({ error: null })),
  webhookUrl: 'https://chat.example/hook',
  fetchImpl: okFetch(),
  log: vi.fn(),
  now: () => NOW,
  ...over,
})

describe('LeadRequestSchema', () => {
  it('accepts each form shape', () => {
    expect(LeadRequestSchema.parse(full).form).toBe('full')
    expect(LeadRequestSchema.parse(short).form).toBe('short')
    expect(LeadRequestSchema.parse(trial).form).toBe('trial')
  })

  it.each(['+91 98765-43210', '98765 43210', '09876543210', '919876543210'])('normalises %s to +91 format', (raw) => {
    expect(LeadRequestSchema.parse({ ...short, phone: raw }).phone).toBe('+919876543210')
  })

  it('blanks optional strings', () => {
    const p = LeadRequestSchema.parse({ ...full, email: '', state: '  ', message: '' })
    if (p.form !== 'full') throw new Error('expected full')
    expect(p.email).toBeUndefined()
    expect(p.state).toBeUndefined()
    expect(p.message).toBeUndefined()
  })

  it.each([
    ['a non-Indian phone', { ...full, phone: '12345' }],
    ['a full form without a role', { ...full, role: undefined }],
    ['a full form without a city', { ...full, city: '' }],
    ['an unknown module', { ...full, modules: ['payroll-pro'] }],
    ['a trial without a module', { ...trial, trial_module: undefined }],
    ['a trial for an unknown module', { ...trial, trial_module: 'canteen' }],
    ['no consent', { ...short, consent: false }],
    ['an invalid email', { ...full, email: 'not-an-email' }],
    ['an unknown form', { ...short, form: 'other' }],
    ['a message over 2000 characters', { ...full, message: 'x'.repeat(2001) }],
  ])('rejects %s', (_label, body) => {
    expect(() => LeadRequestSchema.parse(body)).toThrow()
  })
})

describe('isSpam', () => {
  const lead = LeadRequestSchema.parse(short)
  it('passes a person who took their time', () => {
    expect(isSpam(lead, NOW.getTime())).toBe(false)
  })
  it('catches a filled honeypot', () => {
    expect(isSpam({ ...lead, website: 'http://spam.example' }, NOW.getTime())).toBe(true)
  })
  it('ignores a whitespace-only honeypot', () => {
    expect(isSpam({ ...lead, website: '   ' }, NOW.getTime())).toBe(false)
  })
  it('catches a submission faster than a person can type', () => {
    expect(isSpam({ ...lead, rendered_at: NOW.getTime() - (MIN_FILL_MS - 1) }, NOW.getTime())).toBe(true)
    expect(isSpam({ ...lead, rendered_at: NOW.getTime() - MIN_FILL_MS }, NOW.getTime())).toBe(false)
  })
  it('catches a render time in the future', () => {
    expect(isSpam({ ...lead, rendered_at: NOW.getTime() + 10_000 }, NOW.getTime())).toBe(true)
  })
})

describe('toLeadRow', () => {
  it('maps a full form, keeping every field', () => {
    const row = toLeadRow(LeadRequestSchema.parse(full), NOW)
    expect(row).toMatchObject({
      form: 'full',
      role: 'Principal',
      city: 'Pune',
      state: 'Maharashtra',
      email: 'meera@example.com',
      student_strength: '800–1500',
      board: 'CBSE',
      modules: ['fees', 'timetable'],
      trial_module: null,
      message: 'We want to see cover arrangements.',
      source_path: '/contact',
      utm: { utm_source: 'google' },
      consent_at: NOW.toISOString(),
    })
    expect(row).not.toHaveProperty('website')
    expect(row).not.toHaveProperty('rendered_at')
  })

  it('leaves role and city null for the short form', () => {
    const row = toLeadRow(LeadRequestSchema.parse(short), NOW)
    expect(row).toMatchObject({ form: 'short', role: null, city: null, email: null, modules: [], trial_module: null, utm: null })
  })

  it('stores the trial module, mirrored into modules', () => {
    const row = toLeadRow(LeadRequestSchema.parse(trial), NOW)
    expect(row).toMatchObject({ form: 'trial', trial_module: 'exams', modules: ['exams'], role: 'Administrator', city: 'Indore' })
  })

  it('treats an empty utm object and blank source as absent', () => {
    const row = toLeadRow(LeadRequestSchema.parse({ ...short, utm: {}, source_path: '' }), NOW)
    expect(row.utm).toBeNull()
    expect(row.source_path).toBeNull()
  })
})

describe('leadMessage', () => {
  it('summarises a full lead on one line', () => {
    const msg = leadMessage(toLeadRow(LeadRequestSchema.parse(full), NOW))
    expect(msg).toContain('New demo request: Meera Joshi, Principal · Greenfield Public School, Pune, Maharashtra')
    expect(msg).toContain('Phone +919876543210')
    expect(msg).toContain('Modules: fees, timetable')
    expect(msg).toContain('from /contact')
    expect(msg).not.toContain('\n')
  })

  it('labels short and trial leads', () => {
    expect(leadMessage(toLeadRow(LeadRequestSchema.parse(short), NOW))).toMatch(/^New demo request \(short form\): Kabir Shah · Sunrise School/)
    expect(leadMessage(toLeadRow(LeadRequestSchema.parse(trial), NOW))).toMatch(/^New free-trial request \(exams\): Riya M\., Administrator/)
  })

  it('trims a long message', () => {
    const msg = leadMessage(toLeadRow(LeadRequestSchema.parse({ ...full, message: 'y'.repeat(500) }), NOW))
    expect(msg).toContain('y'.repeat(277) + '…')
    expect(msg).not.toContain('y'.repeat(278))
  })
})

describe('pingLeadWebhook', () => {
  const row: LeadRow = toLeadRow(LeadRequestSchema.parse(trial), NOW)

  it('does nothing without a URL', async () => {
    const f = okFetch()
    expect(await pingLeadWebhook(undefined, row, f)).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('posts text (Slack, Google Chat) and content (Discord)', async () => {
    const f = okFetch()
    expect(await pingLeadWebhook('https://chat.example/hook', row, f)).toBe(true)
    const [url, init] = (f as any).mock.calls[0]
    expect(url).toBe('https://chat.example/hook')
    const body = JSON.parse(init.body)
    expect(body.text).toBe(leadMessage(row))
    expect(body.content).toBe(body.text)
  })

  it('logs and returns false on a non-2xx answer', async () => {
    const log = vi.fn()
    const f = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    expect(await pingLeadWebhook('https://chat.example/hook', row, f, log)).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('404'))
  })

  it('logs and returns false when the request throws', async () => {
    const log = vi.fn()
    const f = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await pingLeadWebhook('https://chat.example/hook', row, f, log)).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('webhook failed'), expect.any(Error))
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const log = vi.fn()
      const f = vi.fn(
        (_url: any, init: any) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ) as unknown as typeof fetch
      const p = pingLeadWebhook('https://chat.example/hook', row, f, log)
      await vi.advanceTimersByTimeAsync(5000)
      expect(await p).toBe(false)
      expect(log).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs to the console by default', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch
    await pingLeadWebhook('https://chat.example/hook', row, f)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('createLead', () => {
  it('stores a real lead and pings the team', async () => {
    const d = deps()
    const result = await createLead(full, d)
    expect(result.stored).toBe(true)
    expect(d.insert).toHaveBeenCalledTimes(1)
    expect((d.insert as any).mock.calls[0][0]).toMatchObject({ form: 'full', name: 'Meera Joshi' })
    if (result.stored) expect(await result.ping).toBe(true)
    expect(d.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('stores nothing and pings nobody for a honeypot hit', async () => {
    const d = deps()
    expect(await createLead({ ...short, website: 'http://spam.example' }, d)).toEqual({ stored: false, reason: 'spam' })
    expect(d.insert).not.toHaveBeenCalled()
    expect(d.fetchImpl).not.toHaveBeenCalled()
  })

  it('stores nothing for a too-fast submission', async () => {
    const d = deps()
    expect(await createLead({ ...trial, rendered_at: NOW.getTime() - 500 }, d)).toEqual({ stored: false, reason: 'spam' })
    expect(d.insert).not.toHaveBeenCalled()
  })

  it('still stores the lead when the webhook fails', async () => {
    const log = vi.fn()
    const d = deps({
      log,
      fetchImpl: vi.fn(async () => {
        throw new Error('chat is down')
      }) as unknown as typeof fetch,
    })
    const result = await createLead(trial, d)
    expect(result.stored).toBe(true)
    expect(d.insert).toHaveBeenCalledTimes(1)
    if (result.stored) expect(await result.ping).toBe(false)
    expect(log).toHaveBeenCalled()
  })

  it('stores the lead without a webhook configured', async () => {
    const d = deps({ webhookUrl: undefined })
    const result = await createLead(short, d)
    expect(result.stored).toBe(true)
    if (result.stored) expect(await result.ping).toBe(false)
  })

  it('throws LeadInsertError when the insert fails', async () => {
    const dbError = { message: 'relation "marketing_leads" does not exist' }
    const d = deps({ insert: vi.fn(async () => ({ error: dbError })) })
    await expect(createLead(full, d)).rejects.toBeInstanceOf(LeadInsertError)
    await expect(createLead(full, d)).rejects.toMatchObject({ dbError })
    expect(d.fetchImpl).not.toHaveBeenCalled()
  })

  it('throws a ZodError for invalid input, before any write', async () => {
    const d = deps()
    await expect(createLead({ ...full, phone: 'call me' }, d)).rejects.toMatchObject({ name: 'ZodError' })
    expect(d.insert).not.toHaveBeenCalled()
  })

  it('defaults the clock to now', async () => {
    const d = deps({ now: undefined })
    const result = await createLead({ ...short, rendered_at: Date.now() - 10_000 }, d)
    expect(result.stored).toBe(true)
  })
})
